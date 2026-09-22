const { verifyToken } = require('../utils/jwt');
const PrivacySettings = require('../models/PrivacySettings');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const User = require('../models/User');
const { createEncryptedMessage, recomputeAggregateReceipts } = require('../controllers/messageController');
const { includesId } = require('../utils/privacy');
const push = require('../utils/push');

// In-memory map of live calls keyed by conversationId. WebRTC media flows
// peer-to-peer; the server only relays SDP/ICE signaling and call state.
const activeCalls = new Map();

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

function directPeer(conversation, userId) {
  return conversation?.participantIds?.find((x) => String(x) !== String(userId));
}

function activeCallFor(conversationId) {
  return activeCalls.get(String(conversationId));
}

function userInCall(userId) {
  for (const call of activeCalls.values()) {
    if (String(call.callerId) === String(userId) || String(call.calleeId) === String(userId)) return call;
  }
  return null;
}

// Ends a tracked call and notifies the other participant over their live socket.
function tearDownCall(io, conversationId, reason) {
  const call = activeCallFor(conversationId);
  if (!call) return;
  activeCalls.delete(String(conversationId));
  const { callerId, calleeId } = call;
  io.to(`user:${callerId}`).emit('call:ended', { conversationId: String(conversationId), reason });
  io.to(`user:${calleeId}`).emit('call:ended', { conversationId: String(conversationId), reason });
}

async function callPeerDisplay(userId) {
  const user = await User.findById(userId).select('name username avatarUrl avatarPlaceholder').lean();
  return { id: String(userId), name: user?.name || user?.username || 'SecureChat user', username: user?.username || '', avatarUrl: user?.avatarUrl || '' };
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

        const offlineRecipients = [];
        for (const recipientId of activeMembers(conversation).filter((x) => x !== userId)) {
          if (conversation.type === 'direct' && !await pairAllowsMessaging(userId, recipientId)) continue;
          if (isOnline(recipientId)) {
            await markReceiptDelivered(io, message, recipientId);
            io.to(`user:${recipientId}`).emit('message:new', message.toObject());
          } else {
            offlineRecipients.push(recipientId);
          }
        }

        // Best-effort FCM push for participants without a live socket.
        if (offlineRecipients.length) {
          try {
            const senderName = await push.senderNameFor(userId);
            await push.pushMessage({ conversation, message, senderName, recipientIds: offlineRecipients });
          } catch (pushError) { console.error('[push] message push failed:', pushError.message); }
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

    // ---- Calls / WebRTC signaling (1:1 direct chats only) ----
    //
    // The callee gets call:incoming ONLY when they are online; nobody is
    // woken up with the notification tray for calls (message FCM push exists,
    // a call missed over FCM has no value). Signaling is relayed as-is.

    socket.on('call:invite', async ({ conversationId, kind = 'audio' } = {}, ack) => {
      try {
        const conversation = await acceptedConversation(conversationId, userId);
        if (!conversation || conversation.type !== 'direct') return ack?.({ ok: false, error: 'Calls are only available in 1:1 accepted conversations.' });
        if (activeCallFor(conversationId)) return ack?.({ ok: false, error: 'A call is already active in this conversation.' });
        if (userInCall(userId)) return ack?.({ ok: false, error: 'You are already in another call.' });
        const peerId = directPeer(conversation, userId);
        if (!peerId || !await pairAllowsMessaging(userId, String(peerId))) return ack?.({ ok: false, error: 'Calls are unavailable for this conversation.' });
        if (!isOnline(String(peerId))) return ack?.({ ok: false, error: 'offline' });
        if (userInCall(peerId)) return ack?.({ ok: false, error: 'busy' });
        activeCalls.set(String(conversationId), { conversationId: String(conversationId), callerId: String(userId), calleeId: String(peerId), kind: kind === 'video' ? 'video' : 'audio', startedAt: Date.now() });
        const caller = await callPeerDisplay(userId);
        io.to(`user:${peerId}`).emit('call:incoming', { conversationId: String(conversationId), caller, kind: kind === 'video' ? 'video' : 'audio' });
        ack?.({ ok: true });
      } catch { ack?.({ ok: false, error: 'Call could not be started.' }); }
    });

    socket.on('call:accept', async ({ conversationId } = {}, ack) => {
      try {
        const call = activeCallFor(conversationId);
        if (!call || String(call.calleeId) !== String(userId)) return ack?.({ ok: false });
        io.to(`user:${call.callerId}`).emit('call:accepted', { conversationId: String(conversationId), kind: call.kind });
        ack?.({ ok: true });
      } catch { ack?.({ ok: false }); }
    });

    socket.on('call:reject', async ({ conversationId, reason = 'declined' } = {}, ack) => {
      try {
        const call = activeCallFor(conversationId);
        if (!call || (String(call.callerId) !== String(userId) && String(call.calleeId) !== String(userId))) return ack?.({ ok: false });
        activeCalls.delete(String(conversationId));
        const otherId = String(call.callerId) === String(userId) ? call.calleeId : call.callerId;
        io.to(`user:${otherId}`).emit('call:rejected', { conversationId: String(conversationId), reason });
        ack?.({ ok: true });
      } catch { ack?.({ ok: false }); }
    });

    socket.on('call:cancel', async ({ conversationId } = {}, ack) => {
      try {
        const call = activeCallFor(conversationId);
        if (!call || String(call.callerId) !== String(userId)) return ack?.({ ok: false });
        activeCalls.delete(String(conversationId));
        io.to(`user:${call.calleeId}`).emit('call:cancelled', { conversationId: String(conversationId) });
        ack?.({ ok: true });
      } catch { ack?.({ ok: false }); }
    });

    socket.on('call:end', ({ conversationId } = {}) => tearDownCall(io, conversationId, 'ended'));

    // Relays SDP offers/answers and ICE candidates between the two peers.
    socket.on('call:signal', async ({ conversationId, to, signal } = {}, ack) => {
      try {
        const call = activeCallFor(conversationId);
        if (!call || (String(call.callerId) !== String(userId) && String(call.calleeId) !== String(userId))) return ack?.({ ok: false });
        const otherId = String(call.callerId) === String(userId) ? call.calleeId : call.callerId;
        if (String(to) !== String(otherId)) return ack?.({ ok: false });
        io.to(`user:${otherId}`).emit('call:signal', { conversationId: String(conversationId), from: String(userId), signal });
        ack?.({ ok: true });
      } catch { ack?.({ ok: false }); }
    });

    socket.on('disconnect', async () => {
      const becameOffline = removeSocket(userId, socket.id);
      if (!becameOffline) return;
      await notifyPresence(io, userId, 'offline');
      // End any call the disconnecting user was in (no socket remains, so it
      // is effectively a hang-up).
      for (const [conversationId, call] of activeCalls) {
        if (String(call.callerId) === String(userId) || String(call.calleeId) === String(userId)) {
          tearDownCall(io, conversationId, 'hangup');
        }
      }
    });
  });
};

module.exports.isOnline = isOnline;
