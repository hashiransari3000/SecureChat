import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useE2EE } from '../context/E2EEContext';

export default function DataControlPage() {
  const [passphrase, setPassphrase] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteText, setDeleteText] = useState('');
  const [showDeletePassword, setShowDeletePassword] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const { user, logout } = useAuth();
  const { wipeLocalIdentity } = useE2EE();
  const navigate = useNavigate();

  const handleExport = async () => {
    if (passphrase.length < 10) return setError('Choose an archive passphrase of at least 10 characters. It is used only to encrypt this download.');
    setExporting(true); setError(''); setStatus('');
    try {
      const { data } = await api.post('/data/export', { passphrase });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `securechat-encrypted-data-${new Date().toISOString().slice(0,10)}.json`; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url); setPassphrase(''); setStatus('Encrypted archive created and handed to your browser for download. Keep its passphrase separately.');
    } catch (e) { setError(e.response?.data?.error || 'The encrypted archive could not be prepared.'); }
    finally { setExporting(false); }
  };

  const handleDelete = async () => {
    if (!deletePassword) return setError('Enter your current account password.');
    if (deleteText !== 'DELETE') return setError('Type DELETE exactly. Your data has not been changed.');
    setDeleting(true); setError(''); setStatus('');
    try {
      await api.delete('/data/account', { data: { password: deletePassword, confirmation: deleteText } });
      const userId = String(user?.id || user?._id || '');
      await wipeLocalIdentity().catch(() => {});
      if (userId) {
        localStorage.removeItem(`securechat_pin_v2_${userId}`);
        localStorage.removeItem(`securechat_unread_${userId}`);
        localStorage.removeItem(`securechat_seen_tour_${userId}`);
      }
      await logout(); navigate('/signup', { replace: true });
    } catch (e) { setError(e.response?.data?.error || 'The account could not be deleted. Nothing was changed.'); setDeleting(false); }
  };

  const cancelDelete = () => { setConfirmingDelete(false); setDeletePassword(''); setDeleteText(''); setError(''); };

  return <div className="page-shell narrow-page data-control-page">
    <div className="page-heading"><div><span className="eyebrow">Data sovereignty</span><h1>Your data, your control</h1><p>Portability and deletion are first-class actions. Export is reversible; deletion is deliberately protected against accidental clicks.</p></div></div>

    <section className="panel control-card">
      <div className="section-title"><div><h2>Encrypted data archive</h2><p>Export your account, privacy settings, conversations, messages, security events and sanitized profile photo into one encrypted JSON package.</p></div><span className="status-pill positive">Portable</span></div>
      <div className="privacy-explainer"><span aria-hidden="true">🔐</span><div><strong>AES-256-GCM archive</strong><p>Your passphrase is used to derive the archive key and is not stored by SecureChat. If you forget it, the downloaded package cannot be opened through this feature.</p></div></div>
      <label>Archive passphrase<input type="password" autoComplete="new-password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder="At least 10 characters" /><span className="field-hint">Use a passphrase you do not reuse for your account password.</span></label>
      <button className="primary-button fit-button" onClick={handleExport} disabled={exporting}>{exporting ? 'Encrypting archive…' : 'Request encrypted archive'}</button>
      <details className="technical-disclosure"><summary>Advanced: archive portability limits</summary><p className="microcopy">Your browser’s private encryption key cannot be exported and is never uploaded. The archive therefore contains protected message records and registered-browser verification codes, but a brand-new browser cannot open older messages unless it already has the original local key.</p></details>
    </section>

    <section className="panel danger-zone">
      <div className="section-title"><div><span className="eyebrow danger-text">Irreversible</span><h2>Wipe My Node Data</h2><p>Hard-delete this account and its associated server-side records. This action is intentionally more difficult than a normal setting change.</p></div></div>
      <button className="secondary-button danger-text fit-button" onClick={() => { setConfirmingDelete(true); setError(''); }}>Review permanent deletion</button>
    </section>

    {confirmingDelete && <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-confirm-title"><div className="modal-card delete-confirmation">
        <span className="eyebrow danger-text">Permanent action</span><h2 id="delete-confirm-title">Delete your SecureChat account?</h2>
        <p>SecureChat will hard-delete your account, privacy settings, device registrations, audit records, your messages and your direct conversations. In shared groups, your membership and your own messages are removed while other members’ unrelated data is preserved.</p>
        <label>Current account password
          <div className="password-field"><input type={showDeletePassword ? 'text' : 'password'} autoComplete="current-password" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} placeholder="Verify it is really you" /><button type="button" className="secondary-button compact-button" onClick={() => setShowDeletePassword((v) => !v)}>{showDeletePassword ? 'Hide' : 'Show'}</button></div>
        </label>
        <label>Type <strong>DELETE</strong> to confirm<input value={deleteText} onChange={(e) => setDeleteText(e.target.value)} autoComplete="off" placeholder="DELETE" /></label>
        <div className="confirm-actions"><button className="secondary-button" onClick={cancelDelete} disabled={deleting}>Cancel — keep my data</button><button className="danger-button" onClick={handleDelete} disabled={deleting || !deletePassword || deleteText !== 'DELETE'}>{deleting ? 'Permanently deleting…' : 'Permanently delete account'}</button></div>
        <p className="microcopy">Nothing is deleted until the server verifies both your password and the exact confirmation text. After success, this browser also removes the current account’s local E2EE identity, App Lock PIN, unread counters and onboarding marker.</p>
      </div></div>}

    {status && <div className="success-banner" role="status">✓ {status}</div>}
    {error && <div className="error-banner" role="alert">⚠ {error}</div>}
  </div>;
}
