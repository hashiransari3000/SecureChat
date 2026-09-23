import api from '../api/client';
import { isNativePlatform, showUpdateNotification } from './notifications';

let updaterPromise = null;

function loadUpdater() {
  if (!updaterPromise) {
    updaterPromise = Promise.resolve().then(() => {
      const plugin = window.Capacitor?.Plugins?.AppUpdater || window.Capacitor?.AppUpdater || null;
      if (!plugin) throw new Error('AppUpdater plugin not found');
      return plugin;
    });
  }
  return updaterPromise;
}

export async function getInstalledVersion() {
  if (!isNativePlatform) return null;
  try {
    const updater = await loadUpdater();
    const info = await updater.getVersionCode();
    return { versionCode: Number(info?.versionCode || 0), versionName: String(info?.versionName || '') };
  } catch {
    return null;
  }
}

// Checks the published latest version and, if a newer build exists, shows a
// notification that offers a one-tap download + install of the new APK.
export async function checkForAppUpdate() {
  if (!isNativePlatform) return false;
  try {
    const installed = await getInstalledVersion();
    if (!installed) return false;
    const { data: latest } = await api.get('/app/latest');
    if (!latest || !latest.versionCode) return false;
    if (Number(latest.versionCode) <= installed.versionCode) return false;
    await showUpdateNotification({
      title: 'SecureChat update available',
      body: `Version ${latest.versionName || latest.versionCode} is ready. Tap to download and install.`,
      apkUrl: latest.apkUrl || '',
      versionName: latest.versionName || '',
    });
    return true;
  } catch {
    return false;
  }
}

// Called when an incoming announcement may carry a newer APK: downloads and
// installs it directly (one-tap confirm) instead of opening a browser page.
export async function installAppUpdate(apkUrl) {
  if (!isNativePlatform || !apkUrl) return false;
  if (!/^https:\/\/[^ ]+\.apk$/i.test(apkUrl)) return false;
  try {
    const updater = await loadUpdater();
    await updater.installUpdate({ url: apkUrl });
    return true;
  } catch {
    return false;
  }
}