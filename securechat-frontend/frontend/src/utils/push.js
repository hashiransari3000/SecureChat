import api from '../api/client';
import { isNativePlatform, showMessageNotification } from './notifications';

let pushReady = false;
let _pushListener = null;

function _dbg(stage, msg) {
  try { fetch(`${import.meta.env.VITE_API_URL || ''}/push/debug?stage=${encodeURIComponent(stage)}&msg=${encodeURIComponent(msg || '')}`).catch(() => {}); } catch {}
}

async function loadPushNotifications() {
  _dbg('load-start');
  try {
    const mod = await import('@capacitor/push-notifications');
    _dbg('load-ok');
    return mod.PushNotifications;
  } catch (e) {
    _dbg('load-fail', String(e));
    throw e;
  }
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
  if (shouldSock) return; // user is reading that chat; socket handles inline append
  const title = String(notification.title || notification?.data?.title || 'SecureChat');
  const body = String(notification.body || notification?.data?.body || 'New encrypted message received.');
  if (conversationId) await showMessageNotification({ title, body, conversationId });
}

export async function initializePushNotifications() {
  _dbg('init-enter', `isNative=${isNativePlatform} ready=${pushReady}`);
  if (!isNativePlatform || pushReady) return;
  try {
    const PushNotifications = await loadPushNotifications();
    _dbg('plugin-loaded');

    let permission = null;
    try {
      permission = await PushNotifications.requestPermissions();
      _dbg('permission-result', JSON.stringify(permission));
    } catch (e) {
      _dbg('permission-error', String(e));
    }

    const regListener = await PushNotifications.addListener('registration', ({ value }) => {
      _dbg('event-registration', String(value).slice(0, 25));
      saveToken(value);
    });
    _pushListener = regListener;
    _dbg('listeners-attached');

    await PushNotifications.addListener('registrationError', (e) => { _dbg('registrationError', String(e)); });
    await PushNotifications.addListener('pushNotificationReceived', ({ notification }) => handleForegroundPush(notification));
    await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
      const conversationId = String(notification?.data?.conversationId || '');
      if (!conversationId) return;
      window.dispatchEvent(new CustomEvent('securechat:open-conversation', { detail: { conversationId } }));
    });

    _dbg('calling-register');
    await PushNotifications.register();
    _dbg('register-returned');
    pushReady = true;
  } catch (e) {
    _dbg('init-error', String(e));
  }
}