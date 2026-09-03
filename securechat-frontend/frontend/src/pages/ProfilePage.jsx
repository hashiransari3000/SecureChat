import { useRef, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { usePrivacy } from '../context/PrivacyContext';
import Avatar from '../components/Avatar';
import { Camera, LogOut, ShieldCheck, Trash2 } from 'lucide-react';

const MAX_FILE = 5 * 1024 * 1024;

export default function ProfilePage() {
  const { user, replaceUser, logout } = useAuth();
  const { settings } = usePrivacy();
  const [name, setName] = useState(user?.name || '');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [confirmLogout, setConfirmLogout] = useState(false);
  const fileRef = useRef(null);

  const saveName = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setStatus('');
    try {
      const { data } = await api.patch('/users/me', { name });
      replaceUser(data.user); setStatus('Display name updated. Existing connections will see the new name.');
    } catch (e2) { setError(e2.response?.data?.error || 'Could not update your profile.'); }
    finally { setBusy(false); }
  };

  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(''); setStatus('');
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) return setError('Choose a JPG, PNG, or WebP image.');
    if (file.size > MAX_FILE) return setError('Choose an image smaller than 5 MB.');
    setBusy(true);
    try {
      const form = new FormData(); form.append('avatar', file);
      const { data } = await api.post('/users/me/avatar', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      replaceUser(data.user);
      setStatus('Profile photo updated. EXIF, GPS and camera metadata were stripped before storage.');
    } catch (e2) { setError(e2.response?.data?.error || 'Could not upload this profile photo.'); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true); setError(''); setStatus('');
    try {
      const { data } = await api.delete('/users/me/avatar');
      replaceUser(data.user); setStatus('Profile photo removed. The privacy placeholder is now shown.');
    } catch (e2) { setError(e2.response?.data?.error || 'Could not remove the profile photo.'); }
    finally { setBusy(false); }
  };

  return <div className="page-shell narrow-page">
    <div className="page-heading">
      <div><span className="eyebrow">Identity with boundaries</span><h1>Profile</h1><p>Choose what represents you without exposing more data than the conversation needs.</p></div>
    </div>

    <section className="panel profile-panel">
      <div className="profile-photo-stack">
        <button className="avatar-edit-button" type="button" onClick={() => fileRef.current?.click()} disabled={busy} aria-label="Change profile photo"><Avatar user={user} size="xl" /><span aria-hidden="true"><Camera /></span></button>
        <div><h2>Profile photo</h2><p className="muted">Accepted connections can see this photo. Whether people outside your connections can see it is controlled by <strong>Privacy → Profile photo visibility</strong>.</p></div>
      </div>
      <div className="action-row wrap">
        <input ref={fileRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} />
        <button className="primary-button" disabled={busy} onClick={() => fileRef.current?.click()}><Camera aria-hidden="true" />{user?.avatarUrl ? 'Change photo' : 'Add profile photo'}</button>
        {user?.avatarUrl && <button className="secondary-button" disabled={busy} onClick={remove}><Trash2 aria-hidden="true" />Remove photo</button>}
      </div>
      <div className="privacy-explainer"><span aria-hidden="true"><ShieldCheck /></span><div><strong>Metadata protection is automatic.</strong><p>Your photo is only shown according to your visibility setting. Uploads are re-encoded before storage to remove embedded location and camera details.</p></div></div>
    </section>

    <section className="panel">
      <div className="section-title"><div><h2>Identity details</h2><p>Only your display name is editable here. Your exact username stays a stable discovery handle in this project build.</p></div></div>
      <form className="stack-form" onSubmit={saveName}>
        <label>Display name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required /><span className="field-hint">Shown to accepted connections and on incoming requests you send.</span></label>
        <label>Username<input value={`@${user?.username || ''}`} readOnly aria-readonly="true" /><span className="field-hint">May appear in limited prefix suggestions; email is never searchable.</span></label>
        <label>Email<input value={user?.email || ''} readOnly aria-readonly="true" /><span className="field-hint">Used for login/recovery, never as a public discovery field.</span></label>
        <button className="primary-button fit-button" disabled={busy || name.trim() === user?.name}>{busy ? 'Saving…' : 'Save profile'}</button>
      </form>
    </section>

    <section className="panel visibility-preview">
      <div><span className="eyebrow">What a new person gets</span><h2>Privacy preview</h2></div>
      <div className="preview-identity"><Avatar user={user} hidden={settings?.profilePhotoVisibility === 'connections'} size="lg" /><div><strong>@{user?.username}</strong><p>{settings?.discoverability === 'nobody' ? 'Incognito: new people cannot discover this account.' : 'May appear in limited username suggestions.'}</p><small>{settings?.profilePhotoVisibility === 'connections' ? 'Your real photo stays hidden until connection acceptance.' : 'Your photo may be shown before acceptance.'}</small></div></div>
    </section>

    <section className="panel account-session-panel"><div><h2>Account session</h2><p className="muted">Logged in as <strong>@{user?.username}</strong>. Logging out keeps this browser's encrypted identity so your existing messages remain readable when you return.</p></div><button className="secondary-button" type="button" onClick={() => setConfirmLogout(true)}><LogOut aria-hidden="true" /> Log out</button></section>

    {status && <div className="success-banner" role="status">✓ {status}</div>}
    {error && <div className="error-banner" role="alert">⚠ {error}</div>}
    {confirmLogout && <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="profile-logout-title"><div className="modal-card compact-card"><h2 id="profile-logout-title">Log out of SecureChat?</h2><p>Your encrypted browser identity stays on this device. You can return and read messages encrypted for this browser.</p><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setConfirmLogout(false)}>Stay logged in</button><button className="danger-button" type="button" onClick={logout}>Log out</button></div></div></div>}
  </div>;
}
