import api from '../api/client';
import { isNativePlatform, showMessageNotification } from './notifications';

let pushReady = false;
let _pushListener = null;

function _dbg(stage, msg) {
  try { fetch(`${import.meta.env.VITE_API_URL || ''}/push/debug?stage=${encodeURIComponent(stage)}&msg=${encodeURIComponent(msg || '')}&v=BN4`).catch(() => {}); } catch {}
}

async function saveToken(token) {
  _dbg('token-received', String(token).slice(0, 25));
  try {
    await api.post('/push/token', { token, platform: 'android' });
    _dbg('token-saved');
  } catch (e) {
    _dbg('token-save-fail', String(e));
  }
}

async function handleForegroundPush(notification) {
  const conversationId = String(notification?.data?.conversationId || '');
  const shouldSock = window.__securechatActiveConversationRef?.getCurrent?.() === conversationId;
  if (shouldSock) return;
  const title = String(notification.title || notification?.data?.title || 'SecureChat');
  const body = String(notification.body || notification?.data?.body || 'New encrypted message received.');
  if (conversationId) await showMessageNotification({ title, body, conversationId });
}

export async function initializePushNotifications() {
  _dbg('init-enter', `isNative=${isNativePlatform} ready=${pushReady}`);
  if (!isNativePlatform || pushReady) return;

  try {
    _dbg('a1-checking-capacitor');

    const PushNotifications = window.Capacitor?.Plugins?.PushNotifications
      || window.Capacitor?.PushNotifications
      || null;

    if (!PushNotifications) {
      _dbg('a2-no-plugin-found', `keys=${Object.keys(window.Capacitor?.Plugins || {})}`);
      return;
    }
    _dbg('a3-plugin-found');

    try {
      const perm = await PushNotifications.requestPermissions();
      _dbg('a4-permission', JSON.stringify(perm));
    } catch (e) {
      _dbg('a4-permission-err', String(e));
    }

    const regListener = await PushNotifications.addListener('registration', ({ value }) => {
      _dbg('a5-registration-event', String(value).slice(0, 25));
      saveToken(value);
    });
    _pushListener = regListener;
    _dbg('a6-listeners-attached');

    await PushNotifications.addListener('registrationError', (e) => { _dbg('a6b-registrationError', String(e)); });
    await PushNotifications.addListener('pushNotificationReceived', ({ notification }) => handleForegroundPush(notification));
    await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
      const conversationId = String(notification?.data?.conversationId || '');
      if (!conversationId) return;
      window.dispatchEvent(new CustomEvent('securechat:open-conversation', { detail: { conversationId } }));
    });

    _dbg('a7-calling-register');
    await PushNotifications.register();
    _dbg('a8-register-returned');
    pushReady = true;
  } catch (e) {
    _dbg('a9-init-error', String(e));
  }
}
