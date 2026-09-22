const admin = require('firebase-admin');
const { getMessaging } = require('firebase-admin/messaging');
const PushToken = require('../models/PushToken');
const PrivacySettings = require('../models/PrivacySettings');
const User = require('../models/User');

let attempted = false;
let _app = null;

// Initializes lazily and never throws. If the service-account JSON is missing
// the backend keeps running and push is simply skipped (socket delivery still
// covers live clients).
function initApp() {
  if (attempted) return admin.getApps ? admin.getApps().length > 0 : admin.apps.length > 0;
  attempted = true;
  const credentialsPath = process.env.FCM_SERVICE_ACCOUNT;
  if (!credentialsPath) {
    console.warn('[push] FCM_SERVICE_ACCOUNT not set — push notifications are disabled.');
    return false;
  }
  try {
    // firebase-admin >= v12 exposes cert() at the top level; .credential was
    // removed in v14. Use whichever the installed version provides.
    const credential = admin.credential ? admin.credential.cert(credentialsPath) : admin.cert(credentialsPath);
    _app = admin.initializeApp({ credential, projectId: process.env.FCM_PROJECT_ID || undefined });
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
  const messaging = getMessaging(_app);
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
          notification: { title: title ?? 'SecureChat', body },
          android: {
            priority: 'high',
            notification: { channelId: 'messages', title: title ?? 'SecureChat', body },
          },
          data: {
            conversationId: String(conversation._id),
            kind: 'message',
            messageId: String(message._id || ''),
            senderId: String(message.senderId || ''),
            senderName: String(senderName || ''),
            conversationType: String(conversation.type || 'direct'),
          },
        });
      }
    }

    if (!messages.length) return;
    const chunk = 500;
    for (let i = 0; i < messages.length; i += chunk) {
      const batch = messages.slice(i, i + chunk);
      const result = await messaging.sendEach(batch);
      const dead = [];
      for (const r of result.responses) {
        if (r.success) continue;
        const code = r.error?.errorInfo?.code || r.error?.code || 'UNKNOWN';
        const token = batch[result.responses.indexOf(r)].token;
        if (['UNREGISTERED', 'NOT_FOUND', 'SENDER_ID_MISMATCH', 'INVALID_ARGUMENT'].includes(code)) {
          dead.push(token);
        }
        console.error(`[push] FCM ${code} for token ${String(token).slice(0, 12)}…`);
      }
      if (dead.length) {
        await PushToken.deleteMany({ token: { $in: dead } });
        console.error(`[push] ${dead.length} dead token(s) removed.`);
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

// Broadcasts an app-wide announcement to every registered device. This is a
// system-level notification (a data message carries the destination URL), so
// unlike pushMessage it deliberately ignores per-message privacy levels.
async function pushAnnouncement({ title, body, url }) {
  if (!initApp()) return 0;
  const messaging = getMessaging(_app);
  try {
    const tokens = await PushToken.find().select('token').lean();
    if (!tokens.length) return 0;
    const messages = tokens.map((row) => ({
      token: row.token,
      notification: { title, body },
      android: {
        priority: 'high',
        notification: { channelId: 'messages', title, body },
      },
      data: { kind: 'announcement', url: String(url || ''), title, body },
    }));
    let sent = 0;
    const chunk = 500;
    for (let i = 0; i < messages.length; i += chunk) {
      const batch = messages.slice(i, i + chunk);
      const result = await messaging.sendEach(batch);
      const dead = [];
      for (const r of result.responses) {
        if (r.success) { sent += 1; continue; }
        const code = r.error?.errorInfo?.code || r.error?.code || 'UNKNOWN';
        const token = batch[result.responses.indexOf(r)].token;
        if (['UNREGISTERED', 'NOT_FOUND', 'SENDER_ID_MISMATCH', 'INVALID_ARGUMENT'].includes(code)) {
          dead.push(token);
        }
        console.error(`[push] announce FCM ${code} for token ${String(token).slice(0, 12)}…`);
      }
      if (dead.length) {
        await PushToken.deleteMany({ token: { $in: dead } });
        console.error(`[push] ${dead.length} dead token(s) removed.`);
      }
    }
    return sent;
  } catch (err) {
    console.error('[push] Error sending announcement:', err.message);
    return 0;
  }
}

module.exports = { pushMessage, pushAnnouncement, senderNameFor, initApp };