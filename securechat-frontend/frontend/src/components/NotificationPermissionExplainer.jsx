import { useState } from 'react';
import { Eye } from 'lucide-react';
import { usePrivacy } from '../context/PrivacyContext';
import { isNativePlatform, requestNotificationPermission } from '../utils/notifications';

const EXAMPLES = {
  detailed: 'Ayesha: Are we still meeting at 4?',
  sender_only: 'Ayesha sent a secure message.',
  anonymous: 'New encrypted message received.',
};

export default function NotificationPermissionExplainer({ onClose }) {
  const { settings, updateField } = usePrivacy();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const enable = async () => {
    setBusy(true); setError('');
    try {
      const granted = await requestNotificationPermission();
      if (granted) {
        await updateField('notificationsEnabled', true);
        onClose?.(true);
      } else {
        await updateField('notificationsEnabled', false);
        setError(isNativePlatform ? 'Notifications are not allowed on this device. Turn them on in Android Settings → Apps → SecureChat → Notifications, then try again.' : 'No permission was granted. Messaging still works normally.');
      }
    } catch (e) { setError(e.response?.data?.error || e.message || 'Notifications could not be enabled.'); }
    finally { setBusy(false); }
  };

  return <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="notification-title"><div className="modal-card">
    <span className="eyebrow">Contextual permission</span><h2 id="notification-title">Before your {isNativePlatform ? 'device' : 'browser'} asks</h2>
    <p>Notifications are optional. SecureChat shows an alert when a new message arrives in a chat you are not already reading — on this screen even in the background — without interrupting your active conversation.</p>
    <div className="notification-preview"><span className="preview-label">Your current preview</span><strong>SecureChat</strong><p>{EXAMPLES[settings?.notificationPrivacyLevel || 'sender_only']}</p></div>
    <div className="privacy-explainer"><Eye aria-hidden="true" /><div><strong>Lock-screen privacy matters.</strong><p>Detailed notifications can expose names and message text to anyone who can see your screen. You can choose Sender Only or Anonymous in Privacy settings before enabling permission.</p></div></div>
    <p className="microcopy">{isNativePlatform ? 'The Android permission prompt appears once, after you choose to continue. If you decline, SecureChat does not repeatedly pressure you.' : 'The native browser permission prompt appears only after you choose “Continue to browser permission”. If you decline, SecureChat does not repeatedly pressure you.'}</p>
    {error && <div className="error-banner" role="alert">⚠ {error}</div>}
    <div className="modal-actions"><button className="secondary-button" onClick={() => onClose?.(false)} disabled={busy}>Not now</button><button className="primary-button" onClick={enable} disabled={busy}>{busy ? 'Waiting for permission…' : 'Continue to permission'}</button></div>
  </div></div>;
}
