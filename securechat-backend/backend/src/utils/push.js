const admin = require('firebase-admin');
const PushToken = require('../models/PushToken');
const PrivacySettings = require('../models/PrivacySettings');
const User = require('../models/User');

let attempted = false;

// Initializes lazily and never throws. If the service-account JSON is missing
// the backend keeps running and push is simply skipped (socket delivery still
// covers live clients).
function initApp() {
  if (attempted) return admin.apps.length ? true : false;
  attempted = true;
  const credentialsPath = process.env.FCM_SERVICE_ACCOUNT;
  if (!credentialsPath) {
    console.warn('[push] FCM_SERVICE_ACCOUNT not set — push notifications are disabled.');
    return false;
  }
  try {
    admin.initializeApp({ credential: admin.credential.cert(credentialsPath), projectId: process.env.FCM_PROJECT_ID || undefined });
    console.log('[push] Firebase Cloud Messaging initialized.');
    return true;
  } catch (err) {
    console.error('[push] FCM initialization failed:', err.message);
    return false;
  }
}

function bodyFor(level, senderName) {
  if (level === 'anonymous') return 'New encrypted message received.';
  if (level === 'detailed') return `${senderName} sent a new message.`;
  return `${senderName} sent a secure message.`;
}

// Sends FCM push to the OFF-LINE recipients of a freshly created message.
// Online participants receive the message over their live socket and render a
// local notification themselves, so pushing to them too would double-deliver.
async function pushMessage({ conversation, message, senderName, recipientIds }) {
  if (!message || !conversation || !Array.isArray(recipientIds) || !recipientIds.length) return;
  if (!initApp()) return;
  const messaging = admin.messaging();
  try {
    const [tokens, privacy] = await Promise.all([
      PushToken.find({ userId: { $in: recipientIds } }).lean(),
      PrivacySettings.find({ userId: { $in: recipientIds } }).select('userId notificationsEnabled notificationPrivacyLevel').lean(),
    ]);

    const privacyByUser = new Map(privacy.map((p) => [String(p.userId), p]));
    const grouped = new Map();
    for (const row of tokens) {
      const settings = privacyByUser.get(String(row.userId));
      if (!settings?.notificationsEnabled) continue;
      const key = String(row.userId);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    }

    if (!grouped.size) return;

    const title = conversation.type === 'group' ? (conversation.name || 'SecureChat group') : 'SecureChat';

    const messages = [];
    for (const [userId, rows] of grouped) {
      const settings = privacyByUser.get(userId);
      const body = bodyFor(settings?.notificationPrivacyLevel || 'sender_only', senderName || 'Someone');
      for (const row of rows) {
        messages.push({
          token: row.token,
          notification: { title, body },
          android: { channelId: 'messages', priority: 'high', notificationChannelId: 'messages' },
          data: { conversationId: String(conversation._id), kind: 'message' },
        });
      }
    }

    if (!messages.length) return;
    const chunk = 500;
    for (let i = 0; i < messages.length; i += chunk) {
      const batch = messages.slice(i, i + chunk);
      const result = await messaging.sendEach(batch);
      const failures = result.responses.map((r, idx) => r.success ? null : batch[idx].token).filter(Boolean);
      if (failures.length) {
        await PushToken.deleteMany({ token: { $in: failures } });
        console.error(`[push] ${failures.length} token(s) rejected and removed.`);
      }
    }
  } catch (err) {
    console.error('[push] Error sending FCM:', err.message);
  }
}

// Resolves a sender's display name for notification text.
async function senderNameFor(userId) {
  const user = await User.findById(userId).select('name username').lean().catch(() => null);
  if (!user) return 'Someone';
  return user.name || user.username || 'Someone';
}

module.exports = { pushMessage, senderNameFor, initApp };