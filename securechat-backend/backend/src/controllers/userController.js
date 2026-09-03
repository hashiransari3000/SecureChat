const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const User = require('../models/User');
const PrivacySettings = require('../models/PrivacySettings');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { includesId, canSeeProfilePhoto, isBlockedEither, areConnected } = require('../utils/privacy');

const AVATAR_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'avatars');

function avatarAccessUrl(user) {
  return user?.avatarUrl ? `/users/${String(user._id)}/avatar` : null;
}

function selfProfile(user) {
  return {
    id: user._id,
    name: user.name,
    username: user.username,
    email: user.email,
    phone: user.phone || null,
    avatarUrl: avatarAccessUrl(user),
    createdAt: user.createdAt,
  };
}

async function removeLocalAvatar(avatarUrl) {
  if (!avatarUrl || !avatarUrl.startsWith('/uploads/avatars/')) return;
  const filename = path.basename(avatarUrl);
  try { await fs.unlink(path.join(AVATAR_DIR, filename)); } catch {}
}

async function notifyAcceptedPeers(io, userId, payload) {
  if (!io) return;
  const conversations = await Conversation.find({ participantIds: userId, status: 'accepted' }).select('participantIds pendingParticipantIds type');
  const peers = new Set();
  for (const conversation of conversations) {
    const pending = new Set((conversation.pendingParticipantIds || []).map(String));
    if (conversation.type === 'group' && pending.has(String(userId))) continue;
    for (const peer of conversation.participantIds) {
      if (String(peer) === String(userId) || pending.has(String(peer))) continue;
      if (conversation.type === 'direct' && await isBlockedEither(userId, peer)) continue;
      peers.add(String(peer));
    }
  }
  for (const peerId of peers) io.to(`user:${peerId}`).emit('profile:changed', payload);
}

exports.getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'Account not found.' });
    res.json(selfProfile(user));
  } catch (e) { next(e); }
};


exports.getAvatar = async (req, res, next) => {
  try {
    const owner = await User.findById(req.params.userId).select('_id avatarUrl');
    if (!owner?.avatarUrl?.startsWith('/uploads/avatars/')) return res.status(404).json({ error: 'Profile photo not found.' });

    if (String(owner._id) !== String(req.userId)) {
      const [ownerSettings, viewerSettings, connected] = await Promise.all([
        PrivacySettings.findOne({ userId: owner._id }),
        PrivacySettings.findOne({ userId: req.userId }),
        areConnected(req.userId, owner._id),
      ]);
      const blocked = includesId(viewerSettings?.blockedUserIds, owner._id) || includesId(ownerSettings?.blockedUserIds, req.userId);
      if (blocked || !canSeeProfilePhoto(ownerSettings, connected)) return res.status(404).json({ error: 'Profile photo is private.' });
    }

    const filePath = path.join(AVATAR_DIR, path.basename(owner.avatarUrl));
    const bytes = await fs.readFile(filePath).catch(() => null);
    if (!bytes) return res.status(404).json({ error: 'Profile photo not found.' });
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', 'inline');
    res.send(bytes);
  } catch (e) { next(e); }
};

exports.updateMe = async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    if (name.length < 2 || name.length > 100) {
      return res.status(400).json({ error: 'Display name must be between 2 and 100 characters.' });
    }
    const user = await User.findByIdAndUpdate(req.userId, { $set: { name } }, { new: true });
    if (!user) return res.status(404).json({ error: 'Account not found.' });
    const io = req.app.get('io');
    await notifyAcceptedPeers(io, req.userId, { userId: String(req.userId), field: 'name' });
    res.json({ message: 'Profile updated.', user: selfProfile(user) });
  } catch (e) { next(e); }
};

exports.searchUsers = async (req, res, next) => {
  try {
    const q = String(req.query.username || '').trim().toLowerCase();
    if (!/^[a-z0-9_]{2,30}$/.test(q)) return res.json([]);

    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const candidates = await User.find({ username: { $regex: `^${escaped}`, $options: 'i' }, _id: { $ne: req.userId } })
      .sort({ username: 1 }).limit(8);
    if (!candidates.length) return res.json([]);

    const viewerSettings = await PrivacySettings.findOne({ userId: req.userId });
    const results = await Promise.all(candidates.map(async (target) => {
      const [targetSettings, existing] = await Promise.all([
        PrivacySettings.findOne({ userId: target._id }),
        Conversation.findOne({ type: 'direct', participantIds: { $all: [req.userId, target._id], $size: 2 } }),
      ]);
      if (includesId(viewerSettings?.blockedUserIds, target._id) || includesId(targetSettings?.blockedUserIds, req.userId)) return null;
      const connected = existing?.status === 'accepted';
      if (!connected && targetSettings?.discoverability === 'nobody') return null;
      const photoVisible = canSeeProfilePhoto(targetSettings, connected);
      return {
        id: target._id,
        username: target.username,
        name: connected ? target.name : null,
        avatarUrl: photoVisible && target.avatarUrl ? avatarAccessUrl(target) : null,
        avatarPlaceholder: !photoVisible,
        connected,
        pending: existing?.status === 'pending',
        conversationId: existing?._id || null,
      };
    }));
    res.json(results.filter(Boolean));
  } catch (e) { next(e); }
};

exports.uploadAvatar = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Choose a JPG, PNG, or WebP image.' });
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(req.file.mimetype)) {
      return res.status(415).json({ error: 'Profile photos must be JPG, PNG, or WebP.' });
    }

    await fs.mkdir(AVATAR_DIR, { recursive: true });
    const filename = `${String(req.userId)}-${crypto.randomBytes(8).toString('hex')}.webp`;
    const outputPath = path.join(AVATAR_DIR, filename);

    // Re-decoding + re-encoding removes EXIF/GPS/camera metadata. .rotate()
    // honors orientation before metadata is discarded.
    await sharp(req.file.buffer, { failOn: 'error' })
      .rotate()
      .resize(512, 512, { fit: 'cover', position: 'attention', withoutEnlargement: true })
      .webp({ quality: 84 })
      .toFile(outputPath);

    const user = await User.findById(req.userId);
    if (!user) {
      await fs.unlink(outputPath).catch(() => {});
      return res.status(404).json({ error: 'Account not found.' });
    }

    const previous = user.avatarUrl;
    user.avatarUrl = `/uploads/avatars/${filename}`;
    await user.save();
    await removeLocalAvatar(previous);

    const io = req.app.get('io');
    if (io) io.to(`user:${String(req.userId)}`).emit('profile:updated', { userId: req.userId, avatarUrl: avatarAccessUrl(user), name: user.name });
    await notifyAcceptedPeers(io, req.userId, { userId: String(req.userId), field: 'avatar' });

    res.status(201).json({
      message: 'Profile photo updated. Location and camera metadata were removed before storage.',
      user: selfProfile(user),
      metadataStripped: true,
    });
  } catch (e) {
    if (e?.name === 'Error' && /Input buffer/.test(e.message || '')) return res.status(400).json({ error: 'That image could not be processed.' });
    next(e);
  }
};

exports.deleteAvatar = async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'Account not found.' });
    const previous = user.avatarUrl;
    user.avatarUrl = null;
    await user.save();
    await removeLocalAvatar(previous);
    const io = req.app.get('io');
    if (io) io.to(`user:${String(req.userId)}`).emit('profile:updated', { userId: req.userId, avatarUrl: null, name: user.name });
    await notifyAcceptedPeers(io, req.userId, { userId: String(req.userId), field: 'avatar' });
    res.json({ message: 'Profile photo removed.', user: selfProfile(user) });
  } catch (e) { next(e); }
};

exports.listBlockedUsers = async (req, res, next) => {
  try {
    const settings = await PrivacySettings.findOne({ userId: req.userId }).populate('blockedUserIds', 'name username avatarUrl');
    const users = (settings?.blockedUserIds || []).map((u) => ({ id: u._id, name: u.name, username: u.username, avatarUrl: null }));
    res.json(users);
  } catch (e) { next(e); }
};

exports.blockUser = async (req, res, next) => {
  try {
    const targetId = req.params.userId;
    if (String(targetId) === String(req.userId)) return res.status(400).json({ error: 'You cannot block your own account.' });
    const target = await User.findById(targetId).select('_id');
    if (!target) return res.status(404).json({ error: 'User not found.' });

    await PrivacySettings.updateOne({ userId: req.userId }, { $addToSet: { blockedUserIds: targetId } });

    // Pending requests are removed immediately; accepted history remains visible
    // to the blocker, but future messaging/telemetry is stopped by server checks.
    const pending = await Conversation.findOne({ type: 'direct', participantIds: { $all: [req.userId, targetId], $size: 2 }, status: 'pending' });
    if (pending) {
      await Message.deleteMany({ conversationId: pending._id });
      await pending.deleteOne();
    }

    const io = req.app.get('io');
    if (io) io.to(`user:${String(req.userId)}`).emit('block:changed', { userId: targetId, blocked: true });
    res.json({ message: 'Contact blocked. They cannot discover you through this connection or send messages to you.' });
  } catch (e) { next(e); }
};

exports.unblockUser = async (req, res, next) => {
  try {
    const targetId = req.params.userId;
    await PrivacySettings.updateOne({ userId: req.userId }, { $pull: { blockedUserIds: targetId } });
    const io = req.app.get('io');
    if (io) io.to(`user:${String(req.userId)}`).emit('block:changed', { userId: targetId, blocked: false });
    res.json({ message: 'Contact unblocked. No new chat is created automatically.' });
  } catch (e) { next(e); }
};

exports.removeLocalAvatar = removeLocalAvatar;
