const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const ConversationEvent = require('../models/ConversationEvent');
const PrivacySettings = require('../models/PrivacySettings');
const CryptoDevice = require('../models/CryptoDevice');
const { isBlockedEither } = require('../utils/privacy');
const attachmentController = require('./attachmentController');

const TTL = { off: null, '1h': 60 * 60 * 1000, '1d': 24 * 60 * 60 * 1000, '7d': 7 * 24 * 60 * 60 * 1000 };
const KINDS = new Set(['text', 'attachment', 'voice']);

async function readReceiptEligibleFor(userA, userB) {
  const [a, b] = await Promise.all([
    PrivacySettings.findOne({ userId: userA }).select('readReceipts'),
    PrivacySettings.findOne({ userId: userB }).select('readReceipts'),
  ]);
  return !!(a?.readReceipts && b?.readReceipts);
}

function isPendingMember(conversation, userId) {
  return (conversation.pendingParticipantIds || []).some((id) => String(id) === String(userId));
}

async function accessibleConversation(conversationId, userId, allowPendingDirect = false) {
  const conversation = await Conversation.findById(conversationId);
  if (!conversation || !conversation.participantIds.some((id) => String(id) === String(userId))) return null;
  if (conversation.type === 'group' && isPendingMember(conversation, userId)) return null;
  if (!allowPendingDirect && conversation.status !== 'accepted') return null;
  return conversation;
}

function activeParticipantIds(conversation) {
  const pending = new Set((conversation.pendingParticipantIds || []).map(String));
  return conversation.participantIds.map(String).filter((id) => !pending.has(id));
}

function clearedAtFor(conversation, userId) { return conversation.clearedFor?.find((entry) => String(entry.userId) === String(userId))?.clearedAt || null; }

function activeMessageFilter(conversationId) {
  return {
    conversationId,
    deleted: false,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  };
}

async function expirationFor(conversation) {
  const mode = conversation.disappearingMode || 'off';
  const ttl = TTL[mode];
  return ttl ? new Date(Date.now() + ttl) : null;
}

function validateEnvelope(body) {
  const e2eeVersion = Number(body?.e2eeVersion || 0);
  if (e2eeVersion !== 1) return { ok: false, error: 'This SecureChat build requires end-to-end encrypted message envelopes.' };
  const ciphertext = String(body?.ciphertext || '');
  const iv = String(body?.iv || '');
  const contentKind = String(body?.contentKind || 'text');
  const wrappedKeys = Array.isArray(body?.wrappedKeys) ? body.wrappedKeys : [];
  if (!ciphertext || ciphertext.length > 30000 || !iv || iv.length > 256 || !KINDS.has(contentKind)) return { ok: false, error: 'Invalid encrypted message envelope.' };
  if (!wrappedKeys.length || wrappedKeys.length > 80) return { ok: false, error: 'Encrypted message is missing device key envelopes.' };
  for (const item of wrappedKeys) {
    if (!item || !/^[0-9a-fA-F]{24}$/.test(String(item.userId || '')) || !/^[a-zA-Z0-9._:-]{12,120}$/.test(String(item.deviceId || '')) || !String(item.wrappedKey || '') || String(item.wrappedKey).length > 4096) {
      return { ok: false, error: 'Invalid encrypted device key envelope.' };
    }
  }
  const attachment = body?.attachment || null;
  if ((contentKind === 'attachment' || contentKind === 'voice') && (!attachment?.attachmentId || !attachment?.iv || !attachment?.encryptedSize)) {
    return { ok: false, error: 'Encrypted attachment metadata is incomplete.' };
  }
  if (contentKind === 'text' && attachment) return { ok: false, error: 'Text messages cannot reference an attachment.' };
  return { ok: true, value: { e2eeVersion, ciphertext, iv, wrappedKeys, contentKind, attachment } };
}

async function ensureDeviceCoverage(conversation, wrappedKeys) {
  const participantIds = activeParticipantIds(conversation);
  const devices = await CryptoDevice.find({ userId: { $in: participantIds }, active: true }).select('userId deviceId');
  const covered = new Set(wrappedKeys.map((item) => `${String(item.userId)}:${String(item.deviceId)}`));
  const missingUsers = [];
  for (const userId of participantIds) {
    const userDevices = devices.filter((d) => String(d.userId) === String(userId));
    if (!userDevices.length || !userDevices.some((d) => covered.has(`${String(userId)}:${String(d.deviceId)}`))) missingUsers.push(String(userId));
  }
  return { ok: missingUsers.length === 0, missingUsers };
}

async function buildReceipts(conversation, senderId) {
  const recipientIds = activeParticipantIds(conversation).filter((id) => String(id) !== String(senderId));
  const senderPrivacy = await PrivacySettings.findOne({ userId: senderId }).select('readReceipts');
  const recipientSettings = await PrivacySettings.find({ userId: { $in: recipientIds } }).select('userId readReceipts');
  const map = new Map(recipientSettings.map((s) => [String(s.userId), !!s.readReceipts]));
  return recipientIds.map((userId) => ({
    userId,
    deliveredAt: null,
    readAt: null,
    readReceiptEligible: !!senderPrivacy?.readReceipts && !!map.get(String(userId)),
  }));
}

function recomputeAggregateReceipts(message) {
  const receipts = message.deliveryReceipts || [];
  if (!receipts.length) return;
  if (receipts.every((r) => r.deliveredAt)) {
    message.deliveredAt = new Date(Math.max(...receipts.map((r) => new Date(r.deliveredAt).getTime())));
  } else {
    message.deliveredAt = null;
  }
  if (receipts.every((r) => r.readReceiptEligible && r.readAt)) {
    message.readAt = new Date(Math.max(...receipts.map((r) => new Date(r.readAt).getTime())));
  } else {
    message.readAt = null;
  }
  message.readReceiptEligible = receipts.every((r) => r.readReceiptEligible);
}

async function createEncryptedMessage({ conversation, senderId, envelope }) {
  const validation = validateEnvelope(envelope);
  if (!validation.ok) throw Object.assign(new Error(validation.error), { statusCode: 400 });
  const coverage = await ensureDeviceCoverage(conversation, validation.value.wrappedKeys);
  if (!coverage.ok) throw Object.assign(new Error('A participant has no compatible encrypted device yet. Ask them to open the updated SecureChat app once, then retry.'), { statusCode: 409 });

  const receipts = await buildReceipts(conversation, senderId);
  const expiresAt = await expirationFor(conversation);
  const message = await Message.create({
    conversationId: conversation._id,
    senderId,
    ...validation.value,
    deliveryReceipts: receipts,
    expiresAt,
    readReceiptEligible: receipts.every((r) => r.readReceiptEligible),
  });

  if (validation.value.attachment?.attachmentId) {
    try {
      const record = await attachmentController.linkAttachmentToMessage({
        attachmentId: validation.value.attachment.attachmentId,
        messageId: message._id,
        userId: senderId,
        conversationId: conversation._id,
        expiresAt,
      });
      message.attachment.encryptedSize = record.size;
      await message.save();
    } catch (e) {
      await message.deleteOne();
      throw e;
    }
  }
  return message;
}

exports.getMessages = async (req, res, next) => {
  try {
    const conversation = await accessibleConversation(req.params.conversationId, req.userId, false);
    if (!conversation) return res.status(403).json({ error: 'This conversation is not available until consent is complete.' });
    const filter = activeMessageFilter(conversation._id);
    // Consent boundary for groups: an invited user receives only content sent
    // after they explicitly accepted. Older ciphertext is not returned (and was
    // not encrypted for their device in the first place). Existing migrated
    // groups without a join event keep their prior behavior.
    if (conversation.type === 'group' && String(conversation.createdBy) !== String(req.userId)) {
      const joined = await ConversationEvent.findOne({
        conversationId: conversation._id, actorId: req.userId, type: 'group_joined',
      }).sort({ createdAt: 1 }).select('createdAt').lean();
      if (joined?.createdAt) filter.sentAt = { $gte: joined.createdAt };
    }
    const clearedAt = clearedAtFor(conversation, req.userId);
    if (clearedAt && (!filter.sentAt?.$gte || new Date(clearedAt) > new Date(filter.sentAt.$gte))) filter.sentAt = { $gt: clearedAt };
    const messages = await Message.find(filter).sort({ sentAt: 1 }).lean();
    res.json(messages);
  } catch (e) { next(e); }
};

exports.sendMessage = async (req, res, next) => {
  try {
    const conversation = await accessibleConversation(req.params.conversationId, req.userId, false);
    if (!conversation) return res.status(403).json({ error: 'You cannot send to this conversation.' });
    if (conversation.type === 'direct') {
      const peerId = conversation.participantIds.find((id) => String(id) !== String(req.userId));
      if (!peerId || await isBlockedEither(req.userId, peerId)) return res.status(403).json({ error: 'Messaging is unavailable for this conversation.' });
    }
    const message = await createEncryptedMessage({ conversation, senderId: req.userId, envelope: req.body });
    conversation.lastMessageAt = message.sentAt;
    await conversation.save();
    res.status(201).json(message);
  } catch (e) { next(e); }
};

exports.editMessage = async (req, res, next) => {
  try {
    const message = await Message.findById(req.params.id);
    if (!message || message.deleted || (message.expiresAt && message.expiresAt <= new Date())) return res.status(404).json({ error: 'Message not found.' });
    if (String(message.senderId) !== String(req.userId)) return res.status(403).json({ error: 'You can only edit your own messages.' });
    if (message.contentKind !== 'text') return res.status(400).json({ error: 'Attachments and voice notes cannot be edited. Delete and resend them instead.' });
    const conversation = await accessibleConversation(message.conversationId, req.userId, false);
    if (!conversation) return res.status(403).json({ error: 'Editing is unavailable for this conversation.' });
    if (conversation.type === 'direct') {
      const peerId = conversation.participantIds.find((id) => String(id) !== String(req.userId));
      if (!peerId || await isBlockedEither(req.userId, peerId)) return res.status(403).json({ error: 'Editing is unavailable while this conversation is restricted.' });
    }

    const validation = validateEnvelope({ ...req.body, contentKind: 'text', attachment: null });
    if (!validation.ok) return res.status(400).json({ error: validation.error });
    const coverage = await ensureDeviceCoverage(conversation, validation.value.wrappedKeys);
    if (!coverage.ok) return res.status(409).json({ error: 'A participant has no compatible encrypted device yet.' });

    message.text = null;
    message.e2eeVersion = 1;
    message.ciphertext = validation.value.ciphertext;
    message.iv = validation.value.iv;
    message.wrappedKeys = validation.value.wrappedKeys;
    message.edited = true;
    await message.save();

    const io = req.app.get('io');
    if (io) {
      const pending = new Set((conversation.pendingParticipantIds || []).map(String));
      for (const participantId of conversation.participantIds) if (!pending.has(String(participantId))) io.to(`user:${String(participantId)}`).emit('message:updated', message.toObject());
    }
    res.json(message);
  } catch (e) { next(e); }
};

exports.deleteMessage = async (req, res, next) => {
  try {
    const message = await Message.findById(req.params.id);
    if (!message) return res.status(404).json({ error: 'Message not found.' });
    if (String(message.senderId) !== String(req.userId)) return res.status(403).json({ error: 'You can only delete your own messages.' });
    const conversationId = message.conversationId;
    await attachmentController.removeForMessage(message._id);
    await message.deleteOne();

    const conversation = await Conversation.findById(conversationId).select('participantIds pendingParticipantIds status');
    const io = req.app.get('io');
    if (io && conversation?.status === 'accepted') {
      const pending = new Set((conversation.pendingParticipantIds || []).map(String));
      for (const participantId of conversation.participantIds) if (!pending.has(String(participantId))) io.to(`user:${String(participantId)}`).emit('message:deleted', { messageId: req.params.id, conversationId: String(conversationId) });
    }
    res.json({ message: 'Message permanently deleted for all active participants.' });
  } catch (e) { next(e); }
};

exports.markRead = async (req, res, next) => {
  try {
    const message = await Message.findById(req.params.id);
    if (!message || (message.expiresAt && message.expiresAt <= new Date())) return res.status(404).json({ error: 'Message not found.' });
    const conversation = await accessibleConversation(message.conversationId, req.userId, false);
    if (!conversation) return res.status(403).json({ error: 'This message is not in an active conversation.' });
    if (String(message.senderId) === String(req.userId)) return res.status(400).json({ error: 'You cannot mark your own message as read.' });
    if (conversation.type === 'direct' && await isBlockedEither(message.senderId, req.userId)) return res.json({ read: false });

    const receipt = message.deliveryReceipts?.find((r) => String(r.userId) === String(req.userId));
    if (!receipt) return res.json({ read: false });
    const [senderSettings, recipientSettings] = await Promise.all([
      PrivacySettings.findOne({ userId: message.senderId }).select('readReceipts'),
      PrivacySettings.findOne({ userId: req.userId }).select('readReceipts'),
    ]);
    if (!receipt.readReceiptEligible || !senderSettings?.readReceipts || !recipientSettings?.readReceipts) return res.json({ read: false });

    const now = new Date();
    if (!receipt.deliveredAt) receipt.deliveredAt = now;
    if (!receipt.readAt) receipt.readAt = now;
    recomputeAggregateReceipts(message);
    await message.save();
    res.json({ read: true, messageId: message._id, readAt: receipt.readAt });
  } catch (e) { next(e); }
};

exports.accessibleConversation = accessibleConversation;
exports.activeParticipantIds = activeParticipantIds;
exports.expirationFor = expirationFor;
exports.readReceiptEligibleFor = readReceiptEligibleFor;
exports.validateEnvelope = validateEnvelope;
exports.createEncryptedMessage = createEncryptedMessage;
exports.recomputeAggregateReceipts = recomputeAggregateReceipts;
