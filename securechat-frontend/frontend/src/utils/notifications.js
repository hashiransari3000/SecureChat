export const isNativePlatform = typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();

let localNotificationsPromise = null;
let channelReady = false;
let tapListenerRegistered = false;
let tapHandlers = [];
let idCounter = 0;

const CHANNEL_ID = 'messages';

function nextNotificationId() {
  idCounter = (idCounter + 1) % 2147483647;
  return (Math.floor(Date.now() / 1000) * 65536 + idCounter) % 2147483647;
}

function loadLocalNotifications() {
  if (!localNotificationsPromise) {
    localNotificationsPromise = import('@capacitor/local-notifications').then((mod) => mod.LocalNotifications);
  }
  return localNotificationsPromise;
}

async function ensureChannel() {
  if (channelReady) return;
  const LocalNotifications = await loadLocalNotifications();
  try {
    await LocalNotifications.createChannel({ id: CHANNEL_ID, name: 'Messages', description: 'New encrypted message alerts', importance: 5, visibility: 1 });
  } catch { /* channel already exists */ }
  channelReady = true;
}

let _tapListener = null;
async function registerTapListener() {
  if (tapListenerRegistered) return;
  const LocalNotifications = await loadLocalNotifications();
  _tapListener = await LocalNotifications.addListener('localNotificationActionPerformed', ({ notification }) => {
    const conversationId = String(notification?.extra?.conversationId || '');
    if (!conversationId) return;
    tapHandlers.forEach((handler) => handler(conversationId));
  });
  tapListenerRegistered = true;
}

export function onNotificationTap(handler) {
  tapHandlers.push(handler);
  if (isNativePlatform) registerTapListener().catch(() => {});
  return () => { tapHandlers = tapHandlers.filter((h) => h !== handler); };
}

export function isNotificationSupported() {
  return isNativePlatform || ('Notification' in window);
}

export async function requestNotificationPermission() {
  if (isNativePlatform) {
    await ensureChannel();
    const LocalNotifications = await loadLocalNotifications();
    const result = await LocalNotifications.requestPermissions();
    return result?.display === 'granted';
  }
  if (!('Notification' in window)) return false;
  return (await Notification.requestPermission()) === 'granted';
}

export async function showMessageNotification({ title, body, conversationId }) {
  if (isNativePlatform) {
    await ensureChannel();
    const LocalNotifications = await loadLocalNotifications();
    await LocalNotifications.schedule({
      notifications: [{
        id: nextNotificationId(),
        title,
        body,
        channelId: CHANNEL_ID,
        extra: { conversationId: String(conversationId) },
      }],
    });
    return;
  }
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const notification = new Notification(title, { body, tag: `securechat-${conversationId}` });
  notification.onclick = () => {
    window.focus();
    tapHandlers.forEach((handler) => handler(String(conversationId)));
    notification.close();
  };
}