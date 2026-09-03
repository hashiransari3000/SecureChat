const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const PrivacySettings = require('../models/PrivacySettings');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const ConversationEvent = require('../models/ConversationEvent');
const AuditLog = require('../models/AuditLog');
const CryptoDevice = require('../models/CryptoDevice');
const Attachment = require('../models/Attachment');
const { removeLocalAvatar } = require('./userController');
const attachmentController = require('./attachmentController');

function encryptJson(payload, passphrase) {
  if (!passphrase || passphrase.length < 10) throw new Error('ARCHIVE_PASSPHRASE_TOO_SHORT');
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return {
    version: 3,
    algorithm: 'AES-256-GCM',
    kdf: 'scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

async function portableAvatar(avatarUrl) {
  if (!avatarUrl?.startsWith('/uploads/avatars/')) return null;
  try {
    const filePath = path.join(__dirname, '..', '..', 'public', 'uploads', 'avatars', path.basename(avatarUrl));
    const bytes = await fs.readFile(filePath);
    return { mimeType: 'image/webp', base64: bytes.toString('base64') };
  } catch { return null; }
}

exports.exportData = async (req, res, next) => {
  try {
    const passphrase = String(req.body.passphrase || '');
    if (passphrase.length < 10) return res.status(400).json({ error: 'Choose an archive passphrase of at least 10 characters. We do not store this passphrase.' });
    const userId = req.userId;
    const [user, privacySettings, conversations, cryptoDevices] = await Promise.all([
      User.findById(userId).select('-passwordHash -resetTokenHash -resetTokenExpiry').lean(),
      PrivacySettings.findOne({ userId }).lean(),
      Conversation.find({ participantIds: userId }).lean(),
      CryptoDevice.find({ userId, active: true }).select('deviceId fingerprint createdAt lastSeenAt').lean(),
    ]);
    if (!user) return res.status(404).json({ error: 'Account not found.' });

    const ids = conversations.map((c) => c._id);
    const [messages, conversationEvents, avatar, attachments] = await Promise.all([
      Message.find({ conversationId: { $in: ids } }).lean(),
      ConversationEvent.find({ conversationId: { $in: ids } }).lean(),
      portableAvatar(user.avatarUrl),
      Attachment.find({ conversationId: { $in: ids } }).select('_id conversationId messageId ownerUserId size createdAt expiresAt').lean(),
    ]);

    const payload = {
      format: 'SecureChat Portable Archive',
      schemaVersion: 3,
      exportedAt: new Date().toISOString(),
      profile: user,
      profilePhoto: avatar,
      privacySettings,
      conversations,
      conversationEvents,
      messages,
      encryptedAttachmentIndex: attachments,
      cryptographicDevices: cryptoDevices,
      cryptographicIdentity: {
        privateKeyIncluded: false,
        reason: 'Message private keys are non-extractable browser CryptoKeys and never reach the server. This prevents a server-side archive request from silently exporting decryption secrets.',
      },
      notes: [
        'Password hashes and password-reset secrets are deliberately excluded.',
        'Security audit records are not included in the portable archive.',
        'New message bodies are exported as end-to-end encrypted ciphertext. Decryption depends on a registered browser device that already holds its local private key.',
      ],
    };

    const archive = encryptJson(payload, passphrase);
    await AuditLog.create({ userId, action: 'data_exported', detail: { format: 'encrypted-json', version: 3 } });
    res.json(archive);
  } catch (e) {
    if (e.message === 'ARCHIVE_PASSPHRASE_TOO_SHORT') return res.status(400).json({ error: 'Choose a longer archive passphrase.' });
    next(e);
  }
};

exports.deleteAccount = async (req, res, next) => {
  try {
    const password = String(req.body.password || '');
    const confirmation = String(req.body.confirmation || '');
    if (!password) return res.status(400).json({ error: 'Enter your account password to authorize permanent deletion.' });
    if (confirmation !== 'DELETE') return res.status(400).json({ error: 'Type DELETE exactly to confirm that you understand this action is permanent.' });

    const userId = req.userId;
    const user = await User.findById(userId).select('+passwordHash');
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(400).json({ error: 'Password verification failed. Your data was not deleted.' });

    const conversations = await Conversation.find({ participantIds: userId });
    const direct = conversations.filter((c) => c.type !== 'group');
    const groups = conversations.filter((c) => c.type === 'group');
    const directIds = direct.map((c) => c._id);
    const allIds = conversations.map((c) => c._id);
    const peers = [...new Set(conversations.flatMap((c) => c.participantIds.map(String)).filter((x) => x !== String(userId)))];
    const avatarUrl = user.avatarUrl;

    // Remove encrypted attachment files for all direct chats being destroyed and
    // for any attachment uploaded by this user in a retained group.
    await attachmentController.removeForConversations(directIds);
    await attachmentController.removeForOwner(userId);

    await Promise.all([
      Message.deleteMany({ $or: [{ senderId: userId }, { conversationId: { $in: directIds } }] }),
      ConversationEvent.deleteMany({ $or: [{ conversationId: { $in: directIds } }, { actorId: userId }] }),
      Conversation.deleteMany({ _id: { $in: directIds } }),
      PrivacySettings.deleteOne({ userId }),
      PrivacySettings.updateMany({}, { $pull: { blockedUserIds: userId } }),
      CryptoDevice.deleteMany({ userId }),
      AuditLog.deleteMany({ userId }),
    ]);

    for (const group of groups) {
      group.participantIds = group.participantIds.filter((x) => String(x) !== String(userId));
      group.pendingParticipantIds = group.pendingParticipantIds.filter((x) => String(x) !== String(userId));
      group.adminIds = group.adminIds.filter((x) => String(x) !== String(userId));
      const pending = new Set(group.pendingParticipantIds.map(String));
      const active = group.participantIds.map(String).filter((x) => !pending.has(x));
      if (!active.length) {
        await Promise.all([Message.deleteMany({ conversationId: group._id }), ConversationEvent.deleteMany({ conversationId: group._id })]);
        await attachmentController.removeForConversations([group._id]);
        await group.deleteOne();
      } else {
        if (!group.adminIds.length) group.adminIds = [active[0]];
        await group.save();
      }
    }

    await User.findByIdAndDelete(userId);
    await removeLocalAvatar(avatarUrl);

    const io = req.app.get('io');
    if (io) {
      for (const peerId of peers) io.to(`user:${peerId}`).emit('account:removed', { userId: String(userId) });
      io.to(`user:${String(userId)}`).emit('account:deleted');
    }

    res.json({ message: 'Your account, direct conversations, messages, encrypted-device registrations, privacy settings, and owned node data have been permanently deleted. In shared groups, your account and messages were removed without erasing other members’ data.' });
  } catch (e) { next(e); }
};
