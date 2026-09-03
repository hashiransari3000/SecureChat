const PrivacySettings = require('../models/PrivacySettings');
const AuditLog = require('../models/AuditLog');
const Conversation = require('../models/Conversation');
const ConversationEvent = require('../models/ConversationEvent');
const Message = require('../models/Message');
const { isBlockedEither } = require('../utils/privacy');

const ALLOWED_FIELDS = [
  'discoverability',
  'onlineStatus',
  'profilePhotoVisibility',
  'readReceipts',
  'showTypingStatus',
  'notificationPrivacyLevel',
  'notificationsEnabled',
  'defaultDisappearingMessages',
  'appLockTimeout',
  'analyticsAllowed',
  'textSize',
  'theme',
  'highContrast',
  'reducedMotion',
];

const ENUMS = {
  discoverability: ['everyone', 'nobody'],
  onlineStatus: ['visible', 'hidden'],
  profilePhotoVisibility: ['everyone', 'connections'],
  notificationPrivacyLevel: ['detailed', 'sender_only', 'anonymous'],
  defaultDisappearingMessages: ['off', '1h', '1d', '7d'],
  appLockTimeout: ['off', '5m', '15m', '30m'],
  textSize: ['small', 'medium', 'large'],
  theme: ['system', 'light', 'dark'],
};

const BOOLEAN_FIELDS = [
  'readReceipts',
  'showTypingStatus',
  'notificationsEnabled',
  'analyticsAllowed',
  'highContrast',
  'reducedMotion',
];

const EVENT_COPY = {
  readReceipts: {
    type: 'read_receipts_changed',
    text: 'Read receipt preference changed. Seen status is shared only when both people allow it.',
  },
  showTypingStatus: {
    type: 'typing_changed',
    text: 'Typing-indicator preference changed. Typing activity is shared only when both people allow it.',
  },
  onlineStatus: {
    type: 'presence_changed',
    text: 'Online-presence preference changed. A private presence is shown as “Presence hidden,” not falsely as offline.',
  },
  profilePhotoVisibility: {
    type: 'profile_photo_visibility_changed',
    text: 'Profile-photo visibility changed. SecureChat applies the new visibility rule at the server response layer.',
  },
};

exports.getSettings = async (req, res, next) => {
  try {
    const settings = await PrivacySettings.findOne({ userId: req.userId });
    if (!settings) return res.status(404).json({ error: 'Privacy settings are not available for this account.' });
    res.json(settings);
  } catch (e) { next(e); }
};

exports.updateSetting = async (req, res, next) => {
  try {
    const { field, value } = req.body;
    if (!ALLOWED_FIELDS.includes(field)) return res.status(400).json({ error: 'That privacy setting is not supported.' });
    if (ENUMS[field] && !ENUMS[field].includes(value)) return res.status(400).json({ error: 'Please choose one of the available options.' });
    if (BOOLEAN_FIELDS.includes(field) && typeof value !== 'boolean') return res.status(400).json({ error: 'This setting must be on or off.' });

    const previous = await PrivacySettings.findOne({ userId: req.userId });
    if (!previous) return res.status(404).json({ error: 'Privacy settings are not available for this account.' });

    const previousValue = previous[field];
    if (String(previousValue) === String(value)) return res.json({ message: 'No change was needed.', settings: previous });

    const settings = await PrivacySettings.findOneAndUpdate(
      { userId: req.userId },
      { $set: { [field]: value } },
      { new: true, runValidators: true }
    );

    await AuditLog.create({ userId: req.userId, action: 'privacy_changed', detail: { field } });

    if (field === 'readReceipts' && value === false) {
      const accepted = await Conversation.find({ participantIds: req.userId, status: 'accepted' }).select('_id');
      const conversationIds = accepted.map((chat) => chat._id);
      if (conversationIds.length) {
        // Freeze unread receipts permanently for messages affected by this opt-out,
        // so turning the setting back on cannot reveal historical reading behavior.
        await Message.updateMany(
          { conversationId: { $in: conversationIds }, senderId: req.userId, readAt: null },
          { $set: { readReceiptEligible: false, 'deliveryReceipts.$[].readReceiptEligible': false } }
        );
        await Message.updateMany(
          { conversationId: { $in: conversationIds }, senderId: { $ne: req.userId }, 'deliveryReceipts.userId': req.userId },
          { $set: { 'deliveryReceipts.$[mine].readReceiptEligible': false, readReceiptEligible: false } },
          { arrayFilters: [{ 'mine.userId': req.userId }] }
        );
      }
    }

    const eventDefinition = EVENT_COPY[field];
    if (eventDefinition) {
      const chats = await Conversation.find({ participantIds: req.userId, status: 'accepted' }).select('_id participantIds pendingParticipantIds type');
      const eligibleChats = [];
      for (const chat of chats) {
        const pending = new Set((chat.pendingParticipantIds || []).map(String));
        if (chat.type === 'group' && pending.has(String(req.userId))) continue;
        const recipients = [];
        for (const participantId of chat.participantIds) {
          if (String(participantId) === String(req.userId) || pending.has(String(participantId))) continue;
          if (chat.type === 'direct' && await isBlockedEither(req.userId, participantId)) continue;
          recipients.push(String(participantId));
        }
        if (recipients.length) eligibleChats.push({ chat, recipients });
      }
      if (eligibleChats.length) {
        await ConversationEvent.insertMany(eligibleChats.map(({ chat }) => ({
          conversationId: chat._id,
          actorId: req.userId,
          type: eventDefinition.type,
          text: eventDefinition.text,
        })));
      }

      const io = req.app.get('io');
      if (io) {
        for (const { chat, recipients } of eligibleChats) {
          for (const recipientId of recipients) io.to(`user:${recipientId}`).emit('privacy:changed', {
            userId: String(req.userId),
            conversationId: String(chat._id),
            field,
            value,
            message: eventDefinition.text,
          });
        }
      }
    }

    res.json({ message: 'Privacy choice saved.', settings, previousValue });
  } catch (e) { next(e); }
};
