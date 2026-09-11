import api from '../api/client';
import { isNativePlatform, showMessageNotification } from './notifications';

let pushReady = false;
let _pushListener = null;

async function loadPushNotifications() {
  return import('@capacitor/push-notifications').then((mod) => mod.PushNotifications);
}

async function saveToken(token) {
  try {
    await api.post('/push/token', { token, platform: 'android' });
  } catch { /* token registration is best-effort; socket path still shows alerts */ }
}

async function handleForegroundPush(notification) {
  const conversationId = String(notification?.data?.conversationId || '');
  const shouldSock = window.__securechatActiveConversationRef?.getCurrent?.() === conversationId;
  if (shouldSock) return; // user is reading that chat; socket handles inline append
  const title = String(notification.title || notification?.data?.title || 'SecureChat');
  const body = String(notification.body || notification?.data?.body || 'New encrypted message received.');
  if (conversationId) await showMessageNotification({ title, body, conversationId });
}

export async function initializePushNotifications() {
  if (!isNativePlatform || pushReady) return;
  try {
    const PushNotifications = await loadPushNotifications();

    const regListener = await PushNotifications.addListener('registration', ({ value }) => saveToken(value));
    _pushListener = regListener;
    await PushNotifications.addListener('registrationError', () => { /* FCM not configured yet */ });
    await PushNotifications.addListener('pushNotificationReceived', ({ notification }) => handleForegroundPush(notification));
    await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
      const conversationId = String(notification?.data?.conversationId || '');
      if (!conversationId) return;
      window.dispatchEvent(new CustomEvent('securechat:open-conversation', { detail: { conversationId } }));
    });

    await PushNotifications.register();
    pushReady = true;
  } catch { /* FCM may not be configured for this APK yet */ }
}