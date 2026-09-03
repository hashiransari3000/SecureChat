const Conversation = require('../models/Conversation');
const ConversationEvent = require('../models/ConversationEvent');
const User = require('../models/User');
const PrivacySettings = require('../models/PrivacySettings');
const Message = require('../models/Message');
const { includesId, canSeeProfilePhoto, isBlockedEither, areConnected } = require('../utils/privacy');
const { validateEnvelope } = require('./messageController');
const CryptoDevice = require('../models/CryptoDevice');
const attachmentController = require('./attachmentController');

function id(value) { return String(value?._id || value || ''); }
function pendingSet(conversation) { return new Set((conversation.pendingParticipantIds || []).map(String)); }
function activeMemberIds(conversation) { const pending = pendingSet(conversation); return conversation.participantIds.map(String).filter((x) => !pending.has(x)); }
function clearedAtFor(conversation, userId) { return conversation.clearedFor?.find((entry) => String(entry.userId) === String(userId))?.clearedAt || null; }

async function pairSettings(viewerId, otherId) {
  const [viewer, other] = await Promise.all([
    PrivacySettings.findOne({ userId: viewerId }),
    PrivacySettings.findOne({ userId: otherId }),
  ]);
  return { viewer, other };
}

function safeMessage(message) {
  if (!message) return null;
  return {
    _id: message._id,
    id: message._id,
    senderId: message.senderId,
    text: message.e2eeVersion === 1 ? null : message.text,
    e2eeVersion: message.e2eeVersion || 0,
    ciphertext: message.ciphertext || null,
    iv: message.iv || null,
    wrappedKeys: message.wrappedKeys || [],
    contentKind: message.contentKind || 'text',
    attachment: message.attachment || null,
    sentAt: message.sentAt,
    edited: message.edited,
  };
}

async function safeConversation(conversation, viewerId) {
  const populated = await conversation.populate('participantIds', 'name username avatarUrl');
  const pending = pendingSet(populated);
  const viewerPending = pending.has(String(viewerId));
  const connected = populated.status === 'accepted' && !viewerPending;

  let viewerPrivacy = await PrivacySettings.findOne({ userId: viewerId });
  const participants = [];
  for (const p of populated.participantIds) {
    const mine = String(p._id) === String(viewerId);
    const isPending = pending.has(String(p._id));
    let avatarUrl = p.avatarUrl || null;
    let avatarPlaceholder = false;
    if (!mine) {
      const privacy = await PrivacySettings.findOne({ userId: p._id });
      // Group membership alone is not treated as a profile-photo connection.
      // A Connections Only avatar is revealed only after an accepted one-to-one
      // connection exists between the viewer and this participant.
      const relationshipVisible = populated.type === 'group'
        ? (!isPending && await areConnected(viewerId, p._id))
        : connected;
      const blocked = includesId(viewerPrivacy?.blockedUserIds, p._id) || includesId(privacy?.blockedUserIds, viewerId);
      // During a pending direct request the requester does not get the
      // recipient's photo, even if that recipient normally allows Everyone.
      // Acceptance is the boundary that enables relationship telemetry/identity.
      const pendingRecipientHidden = populated.type === 'direct' && populated.status === 'pending' && String(populated.requesterId) === String(viewerId);
      const visible = !pendingRecipientHidden && !blocked && canSeeProfilePhoto(privacy, relationshipVisible);
      avatarUrl = visible && avatarUrl ? `/users/${String(p._id)}/avatar` : null;
      avatarPlaceholder = !visible;
    }
    if (mine && avatarUrl) avatarUrl = `/users/${String(p._id)}/avatar`;
    participants.push({ _id: p._id, id: p._id, name: p.name, username: p.username, avatarUrl, avatarPlaceholder, pending: isPending });
  }

  let blockedByMe = false;
  let blockedByPeer = false;
  if (populated.type === 'direct') {
    const other = populated.participantIds.find((p) => String(p._id) !== String(viewerId));
    if (other) {
      const { other: otherPrivacy } = await pairSettings(viewerId, other._id);
      blockedByMe = includesId(viewerPrivacy?.blockedUserIds, other._id);
      blockedByPeer = includesId(otherPrivacy?.blockedUserIds, viewerId);
    }
  }

  const clearedAt = clearedAtFor(populated, viewerId);
  const latestFilter = {
    conversationId: populated._id,
    deleted: false,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  };
  if (clearedAt) latestFilter.sentAt = { $gt: clearedAt };
  const latest = connected ? await Message.findOne(latestFilter).sort({ sentAt: -1 }).lean() : null;

  return {
    _id: populated._id,
    id: populated._id,
    type: populated.type || 'direct',
    name: populated.name || null,
    participantIds: participants,
    pendingParticipantIds: [...pending],
    adminIds: (populated.adminIds || []).map(String),
    createdBy: populated.createdBy,
    requesterId: populated.requesterId,
    status: populated.status,
    acceptedAt: populated.acceptedAt,
    disappearingMode: populated.disappearingMode,
    lastMessageAt: populated.lastMessageAt,
    createdAt: populated.createdAt,
    updatedAt: populated.updatedAt,
    blockedByMe,
    messagingAvailable: connected && (populated.type === 'group' || (!blockedByMe && !blockedByPeer)),
    activeMemberCount: activeMemberIds(populated).length,
    lastMessage: safeMessage(latest),
  };
}

exports.listConversations = async (req, res, next) => {
  try {
    const conversations = await Conversation.find({ participantIds: req.userId, status: 'accepted' }).sort({ lastMessageAt: -1, updatedAt: -1 });
    const result = [];
    for (const conversation of conversations) {
      if (conversation.type === 'group' && pendingSet(conversation).has(String(req.userId))) continue;
      result.push(await safeConversation(conversation, req.userId));
    }
    res.json(result);
  } catch (e) { next(e); }
};

exports.listRequests = async (req, res, next) => {
  try {
    const conversations = await Conversation.find({
      type: 'direct', participantIds: req.userId, status: 'pending', requesterId: { $ne: req.userId },
    }).sort({ createdAt: -1 });

    const result = [];
    for (const conversation of conversations) {
      const populated = await conversation.populate('participantIds', 'name username avatarUrl');
      const sender = populated.participantIds.find((p) => String(p._id) !== String(req.userId));
      if (!sender) continue;
      const [senderPrivacy, viewerPrivacy, firstMessage] = await Promise.all([
        PrivacySettings.findOne({ userId: sender._id }),
        PrivacySettings.findOne({ userId: req.userId }),
        Message.findOne({ conversationId: conversation._id, deleted: false }).sort({ sentAt: 1 }).lean(),
      ]);
      if (includesId(viewerPrivacy?.blockedUserIds, sender._id) || includesId(senderPrivacy?.blockedUserIds, req.userId)) continue;
      const photoVisible = canSeeProfilePhoto(senderPrivacy, false);
      result.push({
        id: conversation._id,
        sender: { id: sender._id, name: sender.name, username: sender.username, avatarUrl: photoVisible && sender.avatarUrl ? `/users/${String(sender._id)}/avatar` : null, avatarPlaceholder: !photoVisible },
        intro: safeMessage(firstMessage),
        createdAt: conversation.createdAt,
      });
    }
    res.json(result);
  } catch (e) { next(e); }
};

exports.listSentRequests = async (req, res, next) => {
  try {
    const conversations = await Conversation.find({ type: 'direct', participantIds: req.userId, requesterId: req.userId, status: 'pending' }).sort({ createdAt: -1 });
    const result = [];
    for (const conversation of conversations) {
      const populated = await conversation.populate('participantIds', 'username avatarUrl');
      const target = populated.participantIds.find((p) => String(p._id) !== String(req.userId));
      if (!target) continue;
      // Consent-first request boundary: the request sender does not receive the
      // recipient's profile photo until the recipient accepts the chat.
      result.push({ id: conversation._id, target: { id: target._id, username: target.username, avatarUrl: null, avatarPlaceholder: true }, createdAt: conversation.createdAt });
    }
    res.json(result);
  } catch (e) { next(e); }
};

async function envelopeCoversUsers(envelope, userIds) {
  const validation = validateEnvelope(envelope);
  if (!validation.ok) return validation;
  const devices = await CryptoDevice.find({ userId: { $in: userIds }, active: true }).select('userId deviceId');
  const wrapped = new Set(validation.value.wrappedKeys.map((x) => `${String(x.userId)}:${String(x.deviceId)}`));
  for (const userId of userIds.map(String)) {
    const userDevices = devices.filter((d) => String(d.userId) === userId);
    if (!userDevices.length || !userDevices.some((d) => wrapped.has(`${userId}:${String(d.deviceId)}`))) return { ok: false, error: 'Both people need an active SecureChat encryption device before a private request can be sent.' };
  }
  return validation;
}

exports.startConversation = async (req, res, next) => {
  try {
    const { otherUserId } = req.body;
    if (!otherUserId || String(otherUserId) === String(req.userId)) return res.status(400).json({ error: 'Choose another user to start a chat.' });
    const otherUser = await User.findById(otherUserId);
    if (!otherUser) return res.status(404).json({ error: 'That user could not be found.' });

    const [myPrivacy, targetPrivacy] = await Promise.all([
      PrivacySettings.findOne({ userId: req.userId }), PrivacySettings.findOne({ userId: otherUserId }),
    ]);
    if (includesId(myPrivacy?.blockedUserIds, otherUserId) || includesId(targetPrivacy?.blockedUserIds, req.userId)) return res.status(404).json({ error: 'That account is not available for a new chat.' });

    let conversation = await Conversation.findOne({ type: 'direct', participantIds: { $all: [req.userId, otherUserId], $size: 2 } });
    if (conversation?.status === 'accepted') return res.status(200).json(await safeConversation(conversation, req.userId));
    if (conversation?.status === 'pending') {
      if (String(conversation.requesterId) !== String(req.userId)) return res.status(409).json({ error: 'This person has already sent you a chat request. Review it under Chat Requests.' });
      return res.status(409).json({ error: 'Your chat request is already waiting for a decision.' });
    }
    if (targetPrivacy?.discoverability === 'nobody') return res.status(404).json({ error: 'No discoverable account matches that username.' });

    const validation = await envelopeCoversUsers(req.body.initialEnvelope, [req.userId, otherUserId]);
    if (!validation.ok) return res.status(400).json({ error: validation.error });
    if (validation.value.contentKind !== 'text') return res.status(400).json({ error: 'A chat request must begin with a short text introduction.' });

    conversation = await Conversation.create({
      type: 'direct', participantIds: [req.userId, otherUserId], requesterId: req.userId,
      status: 'pending', disappearingMode: myPrivacy?.defaultDisappearingMessages || 'off', lastMessageAt: new Date(),
    });
    await Message.create({
      conversationId: conversation._id, senderId: req.userId, ...validation.value,
      deliveredAt: null, readAt: null, readReceiptEligible: false, deliveryReceipts: [{ userId: otherUserId, deliveredAt: null, readAt: null, readReceiptEligible: false }],
    });

    const io = req.app.get('io');
    if (io) io.to(`user:${String(otherUserId)}`).emit('conversation:request', { conversationId: String(conversation._id) });
    res.status(201).json(await safeConversation(conversation, req.userId));
  } catch (e) { next(e); }
};

exports.acceptRequest = async (req, res, next) => {
  try {
    const conversation = await Conversation.findById(req.params.conversationId);
    if (!conversation || conversation.type !== 'direct' || !conversation.participantIds.some((x) => String(x) === String(req.userId))) return res.status(404).json({ error: 'Chat request not found.' });
    if (conversation.status !== 'pending') return res.json(await safeConversation(conversation, req.userId));
    if (String(conversation.requesterId) === String(req.userId)) return res.status(403).json({ error: 'The recipient must accept this request.' });
    conversation.status = 'accepted'; conversation.acceptedAt = new Date(); await conversation.save();
    const event = await ConversationEvent.create({ conversationId: conversation._id, actorId: req.userId, type: 'chat_accepted', text: 'Chat request accepted. Delivery, presence, typing, and read status now follow each person’s privacy choices.' });
    const io = req.app.get('io');
    if (io) for (const participantId of conversation.participantIds) io.to(`user:${String(participantId)}`).emit('conversation:accepted', { conversationId: String(conversation._id), event });
    res.json(await safeConversation(conversation, req.userId));
  } catch (e) { next(e); }
};

exports.declineRequest = async (req, res, next) => {
  try {
    const conversation = await Conversation.findById(req.params.conversationId);
    if (!conversation || conversation.type !== 'direct' || !conversation.participantIds.some((x) => String(x) === String(req.userId))) return res.status(404).json({ error: 'Chat request not found.' });
    if (String(conversation.requesterId) === String(req.userId)) return res.status(403).json({ error: 'Only the recipient can decline this request.' });
    await Promise.all([Message.deleteMany({ conversationId: conversation._id }), ConversationEvent.deleteMany({ conversationId: conversation._id })]);
    await attachmentController.removeForConversations([conversation._id]);
    const requester = conversation.requesterId;
    await conversation.deleteOne();
    req.app.get('io')?.to(`user:${String(requester)}`).emit('conversation:request-removed', { conversationId: req.params.conversationId });
    res.json({ message: 'Chat request declined. The pending encrypted introduction was removed.' });
  } catch (e) { next(e); }
};

exports.cancelRequest = async (req, res, next) => {
  try {
    const conversation = await Conversation.findById(req.params.conversationId);
    if (!conversation || conversation.type !== 'direct' || conversation.status !== 'pending' || String(conversation.requesterId) !== String(req.userId)) return res.status(404).json({ error: 'Pending sent request not found.' });
    await Promise.all([Message.deleteMany({ conversationId: conversation._id }), ConversationEvent.deleteMany({ conversationId: conversation._id })]);
    await attachmentController.removeForConversations([conversation._id]);
    const peer = conversation.participantIds.find((x) => String(x) !== String(req.userId));
    await conversation.deleteOne();
    if (peer) req.app.get('io')?.to(`user:${String(peer)}`).emit('conversation:request-removed', { conversationId: req.params.conversationId });
    res.json({ message: 'Chat request cancelled and removed.' });
  } catch (e) { next(e); }
};

exports.createGroup = async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const invitees = [...new Set((Array.isArray(req.body.participantIds) ? req.body.participantIds : []).map(String).filter((x) => x && x !== String(req.userId)))];
    if (name.length < 2 || name.length > 60) return res.status(400).json({ error: 'Group name must be between 2 and 60 characters.' });
    if (invitees.length < 1 || invitees.length > 30) return res.status(400).json({ error: 'Choose between 1 and 30 existing connections.' });

    // Data-ethics rule: only an already accepted 1:1 connection may be invited.
    const directConnections = await Conversation.find({ type: 'direct', status: 'accepted', participantIds: req.userId }).select('participantIds');
    const connected = new Set(directConnections.flatMap((c) => c.participantIds.map(String).filter((x) => x !== String(req.userId))));
    for (const userId of invitees) {
      if (!connected.has(userId) || await isBlockedEither(req.userId, userId)) return res.status(400).json({ error: 'Groups can invite only accepted, unblocked connections.' });
    }

    const conversation = await Conversation.create({
      type: 'group', name, participantIds: [req.userId, ...invitees], pendingParticipantIds: invitees,
      adminIds: [req.userId], createdBy: req.userId, requesterId: req.userId, status: 'accepted', acceptedAt: new Date(),
      disappearingMode: (await PrivacySettings.findOne({ userId: req.userId }).select('defaultDisappearingMessages'))?.defaultDisappearingMessages || 'off',
      lastMessageAt: new Date(),
    });
    const event = await ConversationEvent.create({
      conversationId: conversation._id, actorId: req.userId, type: 'group_created',
      text: 'Group created. Invited members must explicitly accept before they receive group messages or live activity signals.',
    });
    const io = req.app.get('io');
    if (io) for (const userId of invitees) io.to(`user:${userId}`).emit('group:invite', { conversationId: String(conversation._id), name });
    res.status(201).json({ ...(await safeConversation(conversation, req.userId)), event });
  } catch (e) { next(e); }
};

exports.listGroupInvites = async (req, res, next) => {
  try {
    const groups = await Conversation.find({ type: 'group', status: 'accepted', pendingParticipantIds: req.userId }).sort({ createdAt: -1 });
    const result = [];
    for (const group of groups) {
      const creator = await User.findById(group.createdBy).select('name username avatarUrl');
      result.push({ id: group._id, name: group.name, memberCount: group.participantIds.length, createdAt: group.createdAt, creator: creator ? { id: creator._id, name: creator.name, username: creator.username, avatarUrl: null, avatarPlaceholder: true } : null });
    }
    res.json(result);
  } catch (e) { next(e); }
};

exports.acceptGroupInvite = async (req, res, next) => {
  try {
    const group = await Conversation.findOne({ _id: req.params.conversationId, type: 'group', pendingParticipantIds: req.userId });
    if (!group) return res.status(404).json({ error: 'Group invitation not found.' });
    group.pendingParticipantIds = group.pendingParticipantIds.filter((x) => String(x) !== String(req.userId));
    await group.save();
    const event = await ConversationEvent.create({ conversationId: group._id, actorId: req.userId, type: 'group_joined', text: 'A member joined after explicitly accepting the group invitation.' });
    const io = req.app.get('io');
    if (io) for (const memberId of activeMemberIds(group)) io.to(`user:${memberId}`).emit('group:membership', { conversationId: String(group._id), event });
    res.json(await safeConversation(group, req.userId));
  } catch (e) { next(e); }
};

exports.declineGroupInvite = async (req, res, next) => {
  try {
    const group = await Conversation.findOne({ _id: req.params.conversationId, type: 'group', pendingParticipantIds: req.userId });
    if (!group) return res.status(404).json({ error: 'Group invitation not found.' });
    group.pendingParticipantIds = group.pendingParticipantIds.filter((x) => String(x) !== String(req.userId));
    group.participantIds = group.participantIds.filter((x) => String(x) !== String(req.userId));
    await group.save();
    res.json({ message: 'Group invitation declined. You were not added to the group.' });
  } catch (e) { next(e); }
};

exports.leaveGroup = async (req, res, next) => {
  try {
    const group = await Conversation.findOne({ _id: req.params.conversationId, type: 'group', participantIds: req.userId, status: 'accepted' });
    if (!group || pendingSet(group).has(String(req.userId))) return res.status(404).json({ error: 'Group not found.' });
    group.participantIds = group.participantIds.filter((x) => String(x) !== String(req.userId));
    group.pendingParticipantIds = group.pendingParticipantIds.filter((x) => String(x) !== String(req.userId));
    group.adminIds = group.adminIds.filter((x) => String(x) !== String(req.userId));
    const active = activeMemberIds(group);
    if (!active.length) {
      await Promise.all([Message.deleteMany({ conversationId: group._id }), ConversationEvent.deleteMany({ conversationId: group._id })]);
      await attachmentController.removeForConversations([group._id]);
      await group.deleteOne();
    } else {
      if (!group.adminIds.length) group.adminIds = [active[0]];
      await group.save();
      const event = await ConversationEvent.create({ conversationId: group._id, actorId: req.userId, type: 'group_left', text: 'A member left the group.' });
      const io = req.app.get('io');
      if (io) for (const memberId of active) io.to(`user:${memberId}`).emit('group:membership', { conversationId: String(group._id), event });
    }
    res.json({ message: 'You left the group. SecureChat will no longer deliver its new messages or live activity to this account.' });
  } catch (e) { next(e); }
};

exports.updateDisappearingMode = async (req, res, next) => {
  try {
    const { mode } = req.body;
    if (!['off', '1h', '1d', '7d'].includes(mode)) return res.status(400).json({ error: 'Choose Off, 1 hour, 1 day, or 7 days.' });
    const conversation = await Conversation.findById(req.params.conversationId);
    if (!conversation || conversation.status !== 'accepted' || !conversation.participantIds.some((x) => String(x) === String(req.userId)) || (conversation.type === 'group' && pendingSet(conversation).has(String(req.userId)))) return res.status(404).json({ error: 'Conversation not found.' });
    if (conversation.disappearingMode === mode) return res.json(conversation);
    conversation.disappearingMode = mode; await conversation.save();
    const labels = { off: 'Off', '1h': '1 hour', '1d': '1 day', '7d': '7 days' };
    const event = await ConversationEvent.create({ conversationId: conversation._id, actorId: req.userId, type: 'disappearing_changed', text: `Disappearing messages changed to ${labels[mode]}. This applies to new messages only.` });
    const io = req.app.get('io');
    if (io) for (const participantId of activeMemberIds(conversation)) io.to(`user:${participantId}`).emit('conversation:settings', { conversationId: String(conversation._id), disappearingMode: mode, event });
    res.json(conversation);
  } catch (e) { next(e); }
};

exports.clearChat = async (req, res, next) => {
  try {
    const conversation = await Conversation.findById(req.params.conversationId);
    if (!conversation || conversation.status !== 'accepted' || !conversation.participantIds.some((x) => String(x) === String(req.userId)) || (conversation.type === 'group' && pendingSet(conversation).has(String(req.userId)))) return res.status(404).json({ error: 'Conversation not found.' });
    const now = new Date();
    const existing = conversation.clearedFor?.find((entry) => String(entry.userId) === String(req.userId));
    if (existing) existing.clearedAt = now;
    else conversation.clearedFor.push({ userId: req.userId, clearedAt: now });
    await conversation.save();
    req.app.get('io')?.to(`user:${String(req.userId)}`).emit('conversation:cleared', { conversationId: String(conversation._id), clearedAt: now });
    res.json({ clearedAt: now, message: 'Chat history cleared for your account. Other participants were not affected.' });
  } catch (e) { next(e); }
};

exports.listEvents = async (req, res, next) => {
  try {
    const conversation = await Conversation.findById(req.params.conversationId).select('participantIds pendingParticipantIds status type clearedFor createdBy');
    if (!conversation || conversation.status !== 'accepted' || !conversation.participantIds.some((x) => String(x) === String(req.userId)) || (conversation.type === 'group' && pendingSet(conversation).has(String(req.userId)))) return res.status(404).json({ error: 'Conversation not found.' });
    const filter = { conversationId: conversation._id };
    if (conversation.type === 'group') {
      if (String(conversation.createdBy) !== String(req.userId)) {
        const joined = await ConversationEvent.findOne({ conversationId: conversation._id, actorId: req.userId, type: 'group_joined' }).sort({ createdAt: 1 }).select('createdAt').lean();
        if (joined?.createdAt) filter.createdAt = { $gte: joined.createdAt };
      }
    }
    const clearedAt = clearedAtFor(conversation, req.userId);
    if (clearedAt && (!filter.createdAt?.$gte || new Date(clearedAt) > new Date(filter.createdAt.$gte))) filter.createdAt = { $gt: clearedAt };
    const events = await ConversationEvent.find(filter).sort({ createdAt: 1 }).lean();
    res.json(events);
  } catch (e) { next(e); }
};

exports.safeConversation = safeConversation;
exports.activeMemberIds = activeMemberIds;
