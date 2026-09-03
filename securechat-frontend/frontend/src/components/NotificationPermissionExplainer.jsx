import { useState } from 'react';
import { usePrivacy } from '../context/PrivacyContext';

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
      if (!('Notification' in window)) throw new Error('This browser does not support notifications.');
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        await updateField('notificationsEnabled', true);
        onClose?.(true);
      } else {
        await updateField('notificationsEnabled', false);
        setError(permission === 'denied' ? 'Your browser blocked notifications. SecureChat will not keep prompting you; change the browser permission yourself if you want them later.' : 'No permission was granted. Messaging still works normally.');
      }
    } catch (e) { setError(e.response?.data?.error || e.message || 'Notifications could not be enabled.'); }
    finally { setBusy(false); }
  };

  return <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="notification-title"><div className="modal-card">
    <span className="eyebrow">Contextual permission</span><h2 id="notification-title">Before your browser asks</h2>
    <p>Notifications are optional. They help you notice new messages while this SecureChat web tab is open in the background; they are not required to send, receive or read chats.</p>
    <div className="notification-preview"><span className="preview-label">Your current preview</span><strong>SecureChat</strong><p>{EXAMPLES[settings?.notificationPrivacyLevel || 'sender_only']}</p></div>
    <div className="privacy-explainer"><span aria-hidden="true">👁️</span><div><strong>Lock-screen privacy matters.</strong><p>Detailed notifications can expose names and message text to anyone who can see your screen. You can choose Sender Only or Anonymous in Privacy settings before enabling permission.</p></div></div>
    <p className="microcopy">The native browser permission prompt appears only after you choose “Continue to browser permission”. If you decline, SecureChat does not repeatedly pressure you.</p>
    {error && <div className="error-banner" role="alert">⚠ {error}</div>}
    <div className="modal-actions"><button className="secondary-button" onClick={() => onClose?.(false)} disabled={busy}>Not now</button><button className="primary-button" onClick={enable} disabled={busy}>{busy ? 'Waiting for browser…' : 'Continue to browser permission'}</button></div>
  </div></div>;
}
