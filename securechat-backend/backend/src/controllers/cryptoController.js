const crypto = require('crypto');
const CryptoDevice = require('../models/CryptoDevice');
const Conversation = require('../models/Conversation');
const PrivacySettings = require('../models/PrivacySettings');
const { includesId } = require('../utils/privacy');

function stablePublicKeyString(jwk) {
  return JSON.stringify({ kty: jwk?.kty, n: jwk?.n, e: jwk?.e, alg: jwk?.alg || 'RSA-OAEP-256', ext: jwk?.ext !== false });
}

function fingerprintFor(jwk) {
  return crypto.createHash('sha256').update(stablePublicKeyString(jwk)).digest('hex').match(/.{1,4}/g).slice(0, 12).join(' ');
}

function validPublicKey(jwk) {
  return jwk && jwk.kty === 'RSA' && typeof jwk.n === 'string' && jwk.n.length > 100 && typeof jwk.e === 'string';
}

function safeDevice(device) {
  return {
    deviceId: device.deviceId,
    publicKeyJwk: device.publicKeyJwk,
    fingerprint: device.fingerprint,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt,
  };
}

async function activeParticipantIds(conversation) {
  const pending = new Set((conversation.pendingParticipantIds || []).map(String));
  return conversation.participantIds.map(String).filter((id) => !pending.has(id));
}

exports.registerDevice = async (req, res, next) => {
  try {
    const deviceId = String(req.body.deviceId || '').trim();
    const publicKeyJwk = req.body.publicKeyJwk;
    if (!/^[a-zA-Z0-9._:-]{12,120}$/.test(deviceId)) return res.status(400).json({ error: 'Invalid cryptographic device identifier.' });
    if (!validPublicKey(publicKeyJwk)) return res.status(400).json({ error: 'Invalid RSA-OAEP public key.' });

    const existing = await CryptoDevice.findOne({ userId: req.userId, deviceId });
    if (!existing) {
      const count = await CryptoDevice.countDocuments({ userId: req.userId, active: true });
      if (count >= 8) return res.status(409).json({ error: 'This account already has 8 active encrypted devices. Remove an old device before adding another.' });
    }

    const fingerprint = fingerprintFor(publicKeyJwk);
    const device = await CryptoDevice.findOneAndUpdate(
      { userId: req.userId, deviceId },
      { $set: { publicKeyJwk, fingerprint, active: true, lastSeenAt: new Date() } },
      { upsert: true, new: true, runValidators: true }
    );
    res.json({ device: safeDevice(device), message: 'This browser is registered for end-to-end encrypted messages.' });
  } catch (e) { next(e); }
};

exports.listMyDevices = async (req, res, next) => {
  try {
    const devices = await CryptoDevice.find({ userId: req.userId, active: true }).sort({ lastSeenAt: -1 });
    res.json(devices.map(safeDevice));
  } catch (e) { next(e); }
};

exports.removeDevice = async (req, res, next) => {
  try {
    const deviceId = String(req.params.deviceId || '');
    const device = await CryptoDevice.findOneAndUpdate(
      { userId: req.userId, deviceId, active: true },
      { $set: { active: false } },
      { new: true }
    );
    if (!device) return res.status(404).json({ error: 'Encrypted device not found.' });
    res.json({ message: 'Device removed. Messages encrypted only to that device may no longer be readable there.' });
  } catch (e) { next(e); }
};

exports.getConversationRecipients = async (req, res, next) => {
  try {
    const conversation = await Conversation.findById(req.params.conversationId).select('participantIds pendingParticipantIds status type');
    if (!conversation || conversation.status !== 'accepted' || !conversation.participantIds.some((id) => String(id) === String(req.userId))) {
      return res.status(404).json({ error: 'Conversation not found.' });
    }
    if ((conversation.pendingParticipantIds || []).some((id) => String(id) === String(req.userId))) {
      return res.status(403).json({ error: 'Accept the group invitation before receiving encryption recipients.' });
    }

    const userIds = await activeParticipantIds(conversation);
    const devices = await CryptoDevice.find({ userId: { $in: userIds }, active: true });
    const grouped = new Map(userIds.map((id) => [String(id), []]));
    for (const device of devices) grouped.get(String(device.userId))?.push(safeDevice(device));

    res.json({
      conversationId: String(conversation._id),
      participants: userIds.map((userId) => ({ userId, devices: grouped.get(userId) || [] })),
      missingUserIds: userIds.filter((userId) => !(grouped.get(userId) || []).length),
    });
  } catch (e) { next(e); }
};

exports.getUserRecipients = async (req, res, next) => {
  try {
    const targetId = req.params.userId;
    if (String(targetId) === String(req.userId)) return res.status(400).json({ error: 'Choose another account.' });

    const [targetPrivacy, viewerPrivacy, existing] = await Promise.all([
      PrivacySettings.findOne({ userId: targetId }),
      PrivacySettings.findOne({ userId: req.userId }),
      Conversation.findOne({ type: 'direct', participantIds: { $all: [req.userId, targetId], $size: 2 } }),
    ]);
    if (!targetPrivacy) return res.status(404).json({ error: 'Account is unavailable.' });
    if (includesId(targetPrivacy.blockedUserIds, req.userId) || includesId(viewerPrivacy?.blockedUserIds, targetId)) return res.status(404).json({ error: 'Account is unavailable.' });
    if (!existing && targetPrivacy.discoverability === 'nobody') return res.status(404).json({ error: 'Account is unavailable.' });

    const userIds = [String(req.userId), String(targetId)];
    const devices = await CryptoDevice.find({ userId: { $in: userIds }, active: true });
    const grouped = new Map(userIds.map((id) => [id, []]));
    for (const device of devices) grouped.get(String(device.userId))?.push(safeDevice(device));
    res.json({
      participants: userIds.map((userId) => ({ userId, devices: grouped.get(userId) || [] })),
      missingUserIds: userIds.filter((userId) => !(grouped.get(userId) || []).length),
    });
  } catch (e) { next(e); }
};

exports.activeParticipantIds = activeParticipantIds;
