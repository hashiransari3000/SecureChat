const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const Attachment = require('../models/Attachment');
const Conversation = require('../models/Conversation');

const ATTACHMENT_DIR = path.join(__dirname, '..', '..', 'private_uploads', 'attachments');
const UPLOAD_HOLD_MS = 60 * 60 * 1000;

function isPendingMember(conversation, userId) {
  return (conversation.pendingParticipantIds || []).some((id) => String(id) === String(userId));
}

async function activeConversation(conversationId, userId) {
  const conversation = await Conversation.findById(conversationId).select('participantIds pendingParticipantIds status');
  if (!conversation || conversation.status !== 'accepted') return null;
  if (!conversation.participantIds.some((id) => String(id) === String(userId))) return null;
  if (isPendingMember(conversation, userId)) return null;
  return conversation;
}

async function removeAttachmentRecord(record) {
  if (!record) return;
  try { await fs.unlink(path.join(ATTACHMENT_DIR, path.basename(record.storageName))); } catch {}
  try { await Attachment.deleteOne({ _id: record._id }); } catch {}
}

exports.uploadEncrypted = async (req, res, next) => {
  try {
    const conversationId = String(req.body.conversationId || '');
    const conversation = await activeConversation(conversationId, req.userId);
    if (!conversation) return res.status(403).json({ error: 'You cannot attach files to this conversation.' });
    if (!req.file?.buffer?.length) return res.status(400).json({ error: 'Choose a file to attach.' });

    await fs.mkdir(ATTACHMENT_DIR, { recursive: true });
    const storageName = `${crypto.randomBytes(24).toString('hex')}.bin`;
    await fs.writeFile(path.join(ATTACHMENT_DIR, storageName), req.file.buffer, { flag: 'wx' });

    const record = await Attachment.create({
      ownerUserId: req.userId,
      conversationId,
      storageName,
      size: req.file.size,
      expiresAt: new Date(Date.now() + UPLOAD_HOLD_MS),
    });

    res.status(201).json({
      attachmentId: String(record._id),
      encryptedSize: record.size,
      message: 'Encrypted attachment received. SecureChat never received the original filename, MIME type, or plaintext bytes.',
    });
  } catch (e) { next(e); }
};

exports.downloadEncrypted = async (req, res, next) => {
  try {
    const record = await Attachment.findById(req.params.attachmentId);
    if (!record) return res.status(404).json({ error: 'Attachment not found or expired.' });
    const conversation = await activeConversation(record.conversationId, req.userId);
    if (!conversation) return res.status(403).json({ error: 'This attachment is not available to your account.' });

    const filePath = path.join(ATTACHMENT_DIR, path.basename(record.storageName));
    const bytes = await fs.readFile(filePath).catch(() => null);
    if (!bytes) return res.status(404).json({ error: 'Attachment bytes are no longer available.' });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', 'attachment; filename="securechat-encrypted.bin"');
    res.send(bytes);
  } catch (e) { next(e); }
};

exports.linkAttachmentToMessage = async ({ attachmentId, messageId, userId, conversationId, expiresAt }) => {
  if (!attachmentId) return null;
  const record = await Attachment.findOne({
    _id: attachmentId,
    ownerUserId: userId,
    conversationId,
    messageId: null,
    expiresAt: { $gt: new Date() },
  });
  if (!record) throw Object.assign(new Error('The encrypted attachment is missing, expired, or already used.'), { statusCode: 400 });
  record.messageId = messageId;
  record.expiresAt = expiresAt || new Date('2100-01-01T00:00:00.000Z');
  await record.save();
  return record;
};

exports.removeForMessage = async (messageId) => {
  const records = await Attachment.find({ messageId });
  for (const record of records) await removeAttachmentRecord(record);
};

exports.removeForConversations = async (conversationIds) => {
  if (!conversationIds?.length) return;
  const records = await Attachment.find({ conversationId: { $in: conversationIds } });
  for (const record of records) await removeAttachmentRecord(record);
};


exports.removeForOwner = async (ownerUserId) => {
  const records = await Attachment.find({ ownerUserId });
  for (const record of records) await removeAttachmentRecord(record);
};

exports.cleanupExpired = async () => {
  const expired = await Attachment.find({ expiresAt: { $lte: new Date() } }).limit(200);
  for (const record of expired) await removeAttachmentRecord(record);
};
