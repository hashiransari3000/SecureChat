const { verifyToken } = require('../utils/jwt');
const PrivacySettings = require('../models/PrivacySettings');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const { createEncryptedMessage, recomputeAggregateReceipts } = require('../controllers/messageController');
const { includesId } = require('../utils/privacy');

// One account may have several authenticated tabs/devices. Presence is online
// while at least one socket is connected. No last-seen history is stored.
const onlineSockets = new Map();

function addSocket(userId, socketId) {
  const set = onlineSockets.get(userId) || new Set();
  const wasOffline = set.size === 0;
  set.add(socketId); onlineSockets.set(userId, set); return wasOffline;
}
function removeSocket(userId, socketId) {
  const set = onlineSockets.get(userId); if (!set) return true;
  set.delete(socketId); if (!set.size) { onlineSockets.delete(userId); return true; } return false;
}
function isOnline(userId) { return (onlineSockets.get(String(userId))?.size || 0) > 0; }
function pendingSet(conversation) { return new Set((conversation.pendingParticipantIds || []).map(String)); }
function activeMembers(conversation) { const pending = pendingSet(conversation); return conversation.participantIds.map(String).filter((id) => !pending.has(id)); }

async function acceptedConversation(conversationId, userId) {
  const conversation = await Conversation.findById(conversationId).select('participantIds pendingParticipantIds status disappearingMode type clearedFor');
  if (!conversation || conversation.status !== 'accepted') return null;
  if (!conversation.participantIds.some((x) => String(x) === String(userId))) return null;
  if (conversation.type === 'group' && pendingSet(conversation).has(String(userId))) return null;
  return conversation;
}

async function pairAllowsMessaging(userA, userB) {
  const [a, b] = await Promise.all([
    PrivacySettings.findOne({ userId: userA }).select('blockedUserIds'),
    PrivacySettings.findOne({ userId: userB }).select('blockedUserIds'),
  ]);
  return !includesId(a?.blockedUserIds, userB) && !includesId(b?.blockedUserIds, userA);
}

async function acceptedDirectPeers(userId) {
  const chats = await Conversation.find({ type: 'direct', participantIds: userId, status: 'accepted' }).select('participantIds');
  return [...new Set(chats.map((chat) => chat.participantIds.find((x) => String(x) !== String(userId))).filter(Boolean).map(String))];
}

async function notifyPresence(io, userId, state) {
  const settings = await PrivacySettings.findOne({ userId }).select('onlineStatus');
  if (settings?.onlineStatus !== 'visible') return;
  for (const peerId of await acceptedDirectPeers(userId)) {
    if (await pairAllowsMessaging(userId, peerId)) io.to(`user:${peerId}`).emit('presence:update', { userId: String(userId), state });
  }
}

async function presenceStateFor(viewerId, peerId) {
  if (!await pairAllowsMessaging(viewerId, peerId)) return 'unavailable';
  const privacy = await PrivacySettings.findOne({ userId: peerId }).select('onlineStatus');
  if (privacy?.onlineStatus === 'hidden') return 'hidden';
  return isOnline(peerId) ? 'online' : 'offline';
}

async function markReceiptDelivered(io, message, recipientId) {
  const receipt = message.deliveryReceipts?.find((r) => String(r.userId) === String(recipientId));
  if (!receipt || receipt.deliveredAt) return false;
  receipt.deliveredAt = new Date();
  recomputeAggregateReceipts(message);
  await message.save();
  io.to(`user:${String(message.senderId)}`).emit('messages:receipt-update', {
    conversationId: String(message.conversationId), messageId: String(message._id),
    deliveredAt: message.deliveredAt, readAt: message.readAt, deliveryReceipts: message.deliveryReceipts,
  });
  return true;
}

async function deliverQueuedForConversation(io, conversation, recipientId) {
  if (conversation.type === 'direct') {
    const peerId = conversation.participantIds.find((x) => String(x) !== String(recipientId));
    if (!peerId || !await pairAllowsMessaging(recipientId, peerId)) return;
  }

  const clearedAt = conversation.clearedFor?.find((entry) => String(entry.userId) === String(recipientId))?.clearedAt;
  const pendingFilter = {
    conversationId: conversation._id,
    deleted: false,
    'deliveryReceipts': { $elemMatch: { userId: recipientId, deliveredAt: null } },
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  };
  if (clearedAt) pendingFilter.sentAt = { $gt: clearedAt };
  const pending = await Message.find(pendingFilter);
  for (const message of pending) {
    await markReceiptDelivered(io, message, recipientId);
    io.to(`user:${String(recipientId)}`).emit('message:new', message.toObject());
  }

  // Backward-compatible delivery for legacy plaintext 1:1 messages.
  if (conversation.type === 'direct') {
    const legacyFilter = { conversationId: conversation._id, senderId: { $ne: recipientId }, deliveredAt: null, 'deliveryReceipts.0': { $exists: false }, deleted: false, $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] };
    if (clearedAt) legacyFilter.sentAt = { $gt: clearedAt };
    const legacy = await Message.find(legacyFilter);
    for (const message of legacy) {
      message.deliveredAt = new Date(); await message.save();
      io.to(`user:${String(recipientId)}`).emit('message:new', message.toObject());
      io.to(`user:${String(message.senderId)}`).emit('messages:receipt-update', { conversationId: String(conversation._id), messageId: String(message._id), deliveredAt: message.deliveredAt, readAt: message.readAt, deliveryReceipts: [] });
    }
  }
}

async function deliverQueuedForUser(io, userId) {
  const conversations = await Conversation.find({ participantIds: userId, status: 'accepted' }).select('_id participantIds pendingParticipantIds status type clearedFor');
  for (const conversation of conversations) {
    if (conversation.type === 'group' && pendingSet(conversation).has(String(userId))) continue;
    await deliverQueuedForConversation(io, conversation, userId);
  }
}

async function canReceiveGroupSignal(senderId, recipientId) {
  const [sender, receiver] = await Promise.all([
    PrivacySettings.findOne({ userId: senderId }).select('showTypingStatus'),
    PrivacySettings.findOne({ userId: recipientId }).select('showTypingStatus'),
  ]);
  return !!(sender?.showTypingStatus && receiver?.showTypingStatus);
}

module.exports = function initSockets(io) {
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const decoded = verifyToken(token);
      socket.userId = String(decoded.sub);
      next();
    } catch { next(new Error('Invalid or expired session.')); }
  });

  io.on('connection', async (socket) => {
    const userId = socket.userId;
    const becameOnline = addSocket(userId, socket.id);
    socket.join(`user:${userId}`);
    if (becameOnline) await notifyPresence(io, userId, 'online');
    await deliverQueuedForUser(io, userId);

    socket.on('presence:query', async ({ conversationId } = {}, ack) => {
      try {
        const conversation = await acceptedConversation(conversationId, userId);
        if (!conversation) return ack?.({ ok: false });
        if (conversation.type === 'group') {
          const payload = { ok: true, conversationId: String(conversation._id), state: 'group', memberCount: activeMembers(conversation).length };
          socket.emit('presence:state', payload); ack?.(payload); return;
        }
        const peerId = conversation.participantIds.find((x) => String(x) !== userId);
        if (!peerId) return ack?.({ ok: false });
        const payload = { ok: true, conversationId: String(conversation._id), userId: String(peerId), state: await presenceStateFor(userId, String(peerId)) };
        socket.emit('presence:state', payload); ack?.(payload);
      } catch { ack?.({ ok: false }); }
    });

    socket.on('conversation:join', async (conversationId, ack) => {
      try {
        const conversation = await acceptedConversation(conversationId, userId);
        if (!conversation) return ack?.({ ok: false });
        socket.join(`conversation:${conversationId}`);
        await deliverQueuedForConversation(io, conversation, userId);
        if (conversation.type === 'direct') {
          const peerId = conversation.participantIds.find((x) => String(x) !== userId);
          if (peerId) socket.emit('presence:state', { conversationId: String(conversation._id), userId: String(peerId), state: await presenceStateFor(userId, String(peerId)) });
        }
        ack?.({ ok: true });
      } catch { ack?.({ ok: false }); }
    });

    socket.on('message:send', async ({ conversationId, ...envelope } = {}, ack) => {
      try {
        const conversation = await acceptedConversation(conversationId, userId);
        if (!conversation) return ack?.({ ok: false, error: 'This chat is not available for messaging.' });
        if (conversation.type === 'direct') {
          const peerId = conversation.participantIds.find((x) => String(x) !== userId);
          if (!peerId || !await pairAllowsMessaging(userId, String(peerId))) return ack?.({ ok: false, error: 'Messaging is unavailable for this conversation.' });
        }

        const message = await createEncryptedMessage({ conversation, senderId: userId, envelope });
        conversation.lastMessageAt = message.sentAt; await conversation.save();
        io.to(`user:${userId}`).emit('message:new', message.toObject());
        ack?.({ ok: true, message: message.toObject() });

        for (const recipientId of activeMembers(conversation).filter((x) => x !== userId)) {
          if (conversation.type === 'direct' && !await pairAllowsMessaging(userId, recipientId)) continue;
          if (isOnline(recipientId)) {
            await markReceiptDelivered(io, message, recipientId);
            io.to(`user:${recipientId}`).emit('message:new', message.toObject());
          }
        }
      } catch (e) {
        console.error('message:send failed', e);
        ack?.({ ok: false, error: e.statusCode && e.statusCode < 500 ? e.message : 'The message could not be sent. Please try again.' });
      }
    });

    const markMessageRead = async (message, conversation) => {
      if (!message || String(message.senderId) === userId || message.deleted || (message.expiresAt && message.expiresAt <= new Date())) return false;
      if (conversation.type === 'direct' && !await pairAllowsMessaging(message.senderId, userId)) return false;
      const receipt = message.deliveryReceipts?.find((r) => String(r.userId) === userId);
      if (!receipt) return false;
      const [senderSettings, readerSettings] = await Promise.all([
        PrivacySettings.findOne({ userId: message.senderId }).select('readReceipts'),
        PrivacySettings.findOne({ userId }).select('readReceipts'),
      ]);
      if (!receipt.readReceiptEligible || !senderSettings?.readReceipts || !readerSettings?.readReceipts) return false;
      const now = new Date();
      if (!receipt.deliveredAt) receipt.deliveredAt = now;
      if (!receipt.readAt) receipt.readAt = now;
      recomputeAggregateReceipts(message); await message.save();
      io.to(`user:${String(message.senderId)}`).emit('messages:receipt-update', { conversationId: String(message.conversationId), messageId: String(message._id), deliveredAt: message.deliveredAt, readAt: message.readAt, deliveryReceipts: message.deliveryReceipts });
      return true;
    };

    socket.on('message:markRead', async ({ messageId } = {}) => {
      try {
        const message = await Message.findById(messageId);
        if (!message) return;
        const conversation = await acceptedConversation(message.conversationId, userId);
        if (conversation) await markMessageRead(message, conversation);
      } catch {}
    });

    socket.on('conversation:markRead', async ({ conversationId } = {}) => {
      try {
        const conversation = await acceptedConversation(conversationId, userId);
        if (!conversation) return;
        const unread = await Message.find({
          conversationId, senderId: { $ne: userId }, deleted: false,
          'deliveryReceipts': { $elemMatch: { userId, readAt: null, readReceiptEligible: true } },
          $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
        });
        for (const message of unread) await markMessageRead(message, conversation);
      } catch {}
    });

    const relayTyping = async (eventName, conversationId) => {
      const conversation = await acceptedConversation(conversationId, userId);
      if (!conversation) return;
      const source = await PrivacySettings.findOne({ userId }).select('showTypingStatus');
      if (!source?.showTypingStatus) return; // stop at source-side server boundary
      for (const recipientId of activeMembers(conversation).filter((x) => x !== userId)) {
        if (conversation.type === 'direct' && !await pairAllowsMessaging(userId, recipientId)) continue;
        if (!await canReceiveGroupSignal(userId, recipientId)) continue;
        io.to(`user:${recipientId}`).emit(eventName, { userId, conversationId: String(conversationId) });
      }
    };
    socket.on('typing:start', ({ conversationId } = {}) => relayTyping('typing:start', conversationId));
    socket.on('typing:stop', ({ conversationId } = {}) => relayTyping('typing:stop', conversationId));

    socket.on('disconnect', async () => {
      const becameOffline = removeSocket(userId, socket.id);
      if (becameOffline) await notifyPresence(io, userId, 'offline');
    });
  });
};

module.exports.isOnline = isOnline;
