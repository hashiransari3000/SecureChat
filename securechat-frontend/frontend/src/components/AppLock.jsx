import { useEffect, useMemo, useState } from 'react';
import { LockKeyhole } from 'lucide-react';

const encoder = new TextEncoder();

function bytesToB64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}
function b64ToBytes(value) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
async function derivePin(pin, saltBytes) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: 160000 }, material, 256);
  return bytesToB64(new Uint8Array(bits));
}

export default function AppLock({ userId, timeout }) {
  const key = useMemo(() => `securechat_pin_v2_${userId}`, [userId]);
  const [record, setRecord] = useState(() => {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
  });
  const [locked, setLocked] = useState(false);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(0);
  const [blockedUntil, setBlockedUntil] = useState(0);

  useEffect(() => {
    const force = () => record && timeout !== 'off' && setLocked(true);
    window.addEventListener('securechat:lock-now', force);
    return () => window.removeEventListener('securechat:lock-now', force);
  }, [record, timeout]);

  useEffect(() => {
    if (timeout === 'off' || !record) return undefined;
    const minutes = Number(String(timeout).replace('m', ''));
    let lastActivity = Date.now();
    const activity = () => { if (!locked) lastActivity = Date.now(); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastActivity >= minutes * 60_000) setLocked(true);
    };
    // Do not treat window focus as activity: focus may fire just before the
    // visibility event when returning from a long absence and would otherwise
    // erase the inactivity interval before we can lock.
    const events = ['pointerdown', 'keydown', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, activity, { passive: true }));
    document.addEventListener('visibilitychange', onVisibility);
    const timer = setInterval(() => {
      if (Date.now() - lastActivity >= minutes * 60_000) setLocked(true);
    }, 5000);
    return () => {
      clearInterval(timer);
      events.forEach((e) => window.removeEventListener(e, activity));
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [timeout, record, locked]);

  const savePin = async () => {
    setMessage('');
    if (!/^\d{6,8}$/.test(pin)) return setMessage('Use a 6–8 digit PIN so it is harder to guess.');
    if (pin !== confirmPin) return setMessage('The two PIN entries do not match.');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await derivePin(pin, salt);
    const next = { salt: bytesToB64(salt), hash, version: 2 };
    localStorage.setItem(key, JSON.stringify(next));
    setRecord(next); setPin(''); setConfirmPin(''); setMessage('PIN saved only in this browser.');
  };

  const unlock = async () => {
    if (Date.now() < blockedUntil) return;
    if (!/^\d{6,8}$/.test(pin)) return setMessage('Enter your 6–8 digit local PIN.');
    const hash = await derivePin(pin, b64ToBytes(record.salt));
    if (hash !== record.hash) {
      const count = failed + 1;
      setFailed(count); setPin('');
      if (count >= 5) {
        const until = Date.now() + 30_000;
        setBlockedUntil(until); setFailed(0); setMessage('Too many attempts. Try again in 30 seconds.');
        setTimeout(() => { setBlockedUntil(0); setMessage(''); }, 30_000);
      } else setMessage(`Incorrect PIN. ${5 - count} attempt${5 - count === 1 ? '' : 's'} before a short cooldown.`);
      return;
    }
    setLocked(false); setPin(''); setFailed(0); setMessage('');
  };

  if (timeout === 'off') return null;
  if (!record) return <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="set-pin-title">
    <div className="modal-card compact-card">
      <span className="eyebrow">On-device privacy</span>
      <h2 id="set-pin-title">Set your local app-lock PIN</h2>
      <p>Your PIN never leaves this browser. It protects the open SecureChat session from casual physical access after inactivity.</p>
      <label>New PIN<input className="lock-input" autoComplete="new-password" inputMode="numeric" type="password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} placeholder="6–8 digits" /></label>
      <label>Confirm PIN<input className="lock-input" autoComplete="new-password" inputMode="numeric" type="password" value={confirmPin} onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 8))} placeholder="Repeat PIN" onKeyDown={(e) => e.key === 'Enter' && savePin()} /></label>
      {message && <div className="inline-status" role="status">{message}</div>}
      <button className="primary-button" onClick={savePin}>Save local PIN</button>
      <p className="microcopy">This is a local privacy convenience, not a replacement for Windows/macOS device security.</p>
    </div>
  </div>;

  if (!locked) return null;
  return <div className="modal-overlay lock-overlay" role="dialog" aria-modal="true" aria-labelledby="locked-title">
    <div className="modal-card compact-card">
      <div className="lock-hero"><LockKeyhole aria-hidden="true" /></div>
      <h2 id="locked-title">SecureChat is locked</h2>
      <p>Your inactivity timer expired. Messages remain unchanged; the interface is simply hidden until you unlock it.</p>
      <label>Local PIN<input className="lock-input" inputMode="numeric" autoComplete="off" type="password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} onKeyDown={(e) => e.key === 'Enter' && unlock()} autoFocus placeholder="6–8 digit PIN" /></label>
      {message && <div className="error-banner" role="alert">{message}</div>}
      <button className="primary-button" onClick={unlock} disabled={blockedUntil > 0}>Unlock</button>
    </div>
  </div>;
}
