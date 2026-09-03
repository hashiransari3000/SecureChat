import { useEffect, useState } from 'react';
import api from '../api/client';
import { usePrivacy } from '../context/PrivacyContext';
import NotificationPermissionExplainer from '../components/NotificationPermissionExplainer';
import Avatar from '../components/Avatar';

const GROUPS = [
  {
    title: 'Discovery & identity',
    description: 'Control who can locate you and when identity details become visible.',
    items: [
      ['discoverability', 'Discoverability', 'Your username can appear in limited prefix suggestions only when this is Everyone. Incognito removes you from new-user discovery.', 'select', [['everyone','Everyone'],['nobody','Nobody · Incognito']]],
      ['profilePhotoVisibility', 'Profile photo visibility', 'Connections Only keeps your real photo behind a privacy placeholder until the chat is accepted.', 'select', [['everyone','Everyone'],['connections','Connections Only']]],
      ['onlineStatus', 'Online status', 'Visible shares only Online/Offline with accepted contacts. Hidden reveals neither presence nor last-seen history.', 'select', [['visible','Visible'],['hidden','Hidden']]],
    ],
  },
  {
    title: 'Conversation signals',
    description: 'Small social signals can reveal attention and behavior. These controls keep that telemetry intentional.',
    items: [
      ['readReceipts', 'Read receipts', 'Seen status is shared only when both people have read receipts enabled. Turning yours off also stops you receiving Seen status.', 'toggle'],
      ['showTypingStatus', 'Typing indicators', 'Typing telemetry is emitted only when both people allow it. If either person opts out, no typing signal is sent.', 'toggle'],
      ['defaultDisappearingMessages', 'Default disappearing messages', 'Sets the starting timer for new requests/chats. Individual accepted chats can override it.', 'select', [['off','Off'],['1h','1 hour'],['1d','1 day'],['7d','7 days']]],
    ],
  },
  {
    title: 'Notifications & device privacy',
    description: 'Prevent lock-screen leakage and reduce risk when you step away from this browser.',
    items: [
      ['notificationPrivacyLevel', 'Notification privacy level', 'Choose how much message content may appear outside SecureChat.', 'select', [['detailed','Detailed · name + snippet'],['sender_only','Sender only'],['anonymous','Anonymous']]],
      ['appLockTimeout', 'Inactivity app lock', 'After inactivity, hide this session behind a PIN stored only in this browser.', 'select', [['off','Off'],['5m','5 minutes'],['15m','15 minutes'],['30m','30 minutes']]],
    ],
  },
  {
    title: 'Accessibility & comfort',
    description: 'Universal design options are first-class preferences, not hidden assistive afterthoughts.',
    items: [
      ['theme', 'Appearance', 'Choose light, dark, or follow the operating system. This preference changes presentation only.', 'select', [['system','Use system setting'],['light','Light'],['dark','Dark']]],
      ['textSize', 'Text size', 'Adjust interface text without changing browser zoom.', 'select', [['small','Compact'],['medium','Comfortable'],['large','Large']]],
      ['highContrast', 'High contrast', 'Strengthens text, boundaries and focus indicators for easier visual discrimination.', 'toggle'],
      ['reducedMotion', 'Reduce motion', 'Removes non-essential animation and smooth scrolling.', 'toggle'],
    ],
  },
];

function Toggle({ checked, label, onChange }) {
  return <label className="switch-control"><input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} /><span className="switch-track" aria-hidden="true"><span /></span><span className="sr-only">{label}</span></label>;
}

const NOTIFICATION_LEVELS = [
  ['detailed', 'Detailed', 'Sender and message preview'],
  ['sender_only', 'Sender only', 'Sender name, no message content'],
  ['anonymous', 'Anonymous', 'Only a private-message alert'],
];

function NotificationPrivacyOptions({ value, onChange }) {
  return <fieldset className="notification-levels"><legend className="sr-only">Notification privacy level</legend>{NOTIFICATION_LEVELS.map(([id,title,description]) => <label className={value === id ? 'selected' : ''} key={id}><input type="radio" name="notificationPrivacyLevel" value={id} checked={value === id} onChange={() => onChange(id)} /><span><strong>{title}</strong><small>{description}</small></span></label>)}</fieldset>;
}

export default function PrivacyDashboardPage() {
  const { settings, updateField } = usePrivacy();
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [showNotificationsExplainer, setShowNotificationsExplainer] = useState(false);
  const [blocked, setBlocked] = useState([]);

  const loadBlocked = () => api.get('/users/blocked').then(({ data }) => setBlocked(data)).catch(() => {});
  useEffect(() => { loadBlocked(); }, []);

  const update = async (field, value) => {
    setError('');
    const scroller = document.querySelector('.app-content');
    const scrollTop = scroller?.scrollTop || 0;
    try {
      await updateField(field, value);
      if (field === 'highContrast' || field === 'reducedMotion' || field === 'textSize' || field === 'theme') requestAnimationFrame(() => { if (scroller) scroller.scrollTop = scrollTop; });
      setToast('Preference saved and applied server-side.');
      setTimeout(() => setToast(''), 2400);
    } catch (e) { setError(e.response?.data?.error || 'That preference could not be saved.'); }
  };

  const unblock = async (id) => {
    try { await api.delete(`/users/${id}/block`); await loadBlocked(); setToast('Contact unblocked. No chat was restarted automatically.'); }
    catch (e) { setError(e.response?.data?.error || 'Could not unblock this contact.'); }
  };

  if (!settings) return <div className="page-loading" role="status"><span className="spinner" /> Loading privacy controls…</div>;

  const notificationPreview = settings.notificationPrivacyLevel === 'anonymous'
    ? 'New encrypted message received.'
    : settings.notificationPrivacyLevel === 'sender_only'
      ? 'Ayesha sent a secure message.'
      : 'Ayesha: Are we still meeting at 4?';

  return <div className="page-shell settings-page">
    <div className="page-heading"><div><span className="eyebrow">Privacy by design</span><h1>Privacy controls</h1><p>Every setting explains the consequence before you change it. No hidden trade-offs, forced sharing, or misleading defaults.</p></div><div className="privacy-score"><span>Control center</span><strong>{settings.discoverability === 'nobody' ? 'Incognito' : 'Discoverable'}</strong></div></div>

    <div className="info-banner privacy-principle"><strong>Mutual consent rule:</strong> Read receipts and typing indicators are relationship signals. SecureChat shares them only when both participants allow the relevant signal.</div>

    {GROUPS.map((group) => <section className="panel settings-section" id={group.title.startsWith('Accessibility') ? 'accessibility' : group.title.startsWith('Notifications') ? 'notifications' : group.title.startsWith('Discovery') ? 'privacy-security' : undefined} key={group.title}>
      <div className="section-title"><div><h2>{group.title}</h2><p>{group.description}</p></div></div>
      <div className="settings-list">{group.items.map(([field,label,help,type,options]) => <div className="setting-row" key={field}>
        <div className="setting-info"><span className="setting-label">{label}</span><span className="setting-help">{help}</span></div>
        {field === 'notificationPrivacyLevel' ? <NotificationPrivacyOptions value={settings[field]} onChange={(value) => update(field, value)} /> : type === 'select' ? <select aria-label={label} value={settings[field]} onChange={(e) => update(field, e.target.value)}>{options.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select> : <Toggle label={label} checked={settings[field]} onChange={(value) => update(field, value)} />}
      </div>)}</div>
    </section>)}

    <section className="panel notification-card" id="notification-permission">
      <div className="section-title"><div><h2>Browser notification permission</h2><p>SecureChat asks the browser only after a contextual explanation and your explicit action. In this web build, notifications work while the app tab is open.</p></div><span className={`status-pill ${settings.notificationsEnabled ? 'positive' : ''}`}>{settings.notificationsEnabled ? 'Enabled' : 'Off'}</span></div>
      <div className="notification-preview"><span className="preview-label">Lock-screen preview</span><strong>SecureChat</strong><p>{notificationPreview}</p></div>
      <div className="action-row wrap">{!settings.notificationsEnabled ? <button className="primary-button" onClick={() => setShowNotificationsExplainer(true)}>Review before enabling</button> : <button className="secondary-button" onClick={() => update('notificationsEnabled', false)}>Turn app notifications off</button>}</div>
      <p className="microcopy">Turning the app setting off does not alter your browser’s global permission. It simply tells SecureChat not to create notifications.</p>
    </section>

    <section className="panel">
      <div className="section-title"><div><h2>Optional analytics</h2><p>This demo has no analytics collector wired in. The choice remains explicit so a future analytics feature cannot silently assume consent.</p></div><Toggle label="Optional analytics" checked={settings.analyticsAllowed} onChange={(value) => update('analyticsAllowed', value)} /></div>
    </section>

    <section className="panel">
      <div className="section-title"><div><h2>Blocked contacts</h2><p>Blocking is private. A blocked person is not told that you blocked them, and no chat is restarted when you unblock.</p></div><span className="count-badge">{blocked.length}</span></div>
      {blocked.length === 0 ? <div className="empty-inline">You have not blocked anyone.</div> : <div className="blocked-list">{blocked.map((person) => <div className="blocked-row" key={person.id}><Avatar user={person} hidden size="sm" /><div><strong>{person.name}</strong><small>@{person.username}</small></div><button className="secondary-button small-button" onClick={() => unblock(person.id)}>Unblock</button></div>)}</div>}
    </section>

    {error && <div className="error-banner" role="alert">⚠ {error}</div>}
    {toast && <div className="toast" role="status" aria-live="polite">✓ {toast}</div>}
    {showNotificationsExplainer && <NotificationPermissionExplainer onClose={() => setShowNotificationsExplainer(false)} />}
  </div>;
}
