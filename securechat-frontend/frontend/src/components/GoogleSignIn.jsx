import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '432304486079-mdgpiraqhiciv9neskk5f34th6ib5ejl.apps.googleusercontent.com';

function loadGoogleIdentity() {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-securechat-google]');
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true; script.defer = true; script.dataset.securechatGoogle = 'true';
    script.onload = resolve; script.onerror = reject; document.head.appendChild(script);
  });
}

export default function GoogleSignIn({ onComplete }) {
  const { loginWithGoogle, loading, error, setError } = useAuth();
  const buttonRef = useRef(null);
  const credentialRef = useRef('');
  const onCompleteRef = useRef(onComplete);
  const [pendingProfile, setPendingProfile] = useState(null);
  const [username, setUsername] = useState('');

  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  useEffect(() => {
    let cancelled = false;
    loadGoogleIdentity().then(() => {
      if (cancelled || !buttonRef.current) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async ({ credential }) => {
          credentialRef.current = credential;
          const result = await loginWithGoogle(credential);
          if (result.ok) onCompleteRef.current();
          else if (result.needsUsername) {
            setPendingProfile(result.profile);
            setUsername(result.profile.suggestedUsername || '');
          }
        },
      });
      buttonRef.current.replaceChildren();
      window.google.accounts.id.renderButton(buttonRef.current, {
        type: 'standard', theme: 'outline', size: 'large', shape: 'rectangular',
        text: 'continue_with', logo_alignment: 'left', width: Math.min(376, buttonRef.current.clientWidth || 376),
      });
    }).catch(() => setError('Google Sign-In could not load. Check your connection and try again.'));
    return () => { cancelled = true; };
  }, [loginWithGoogle, setError]);

  const finishSignup = async (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (loading || !username.trim()) return;
    const result = await loginWithGoogle(credentialRef.current, username);
    if (result.ok) { setPendingProfile(null); onCompleteRef.current(); }
  };

  return <>
    <div className="auth-divider" aria-hidden="true"><span>or continue with</span></div>
    <div className="google-signin-wrap" ref={buttonRef} aria-label="Continue with Google" />
    <p className="google-privacy-note">Google shares your verified name and email. Your email remains hidden from public search.</p>

    {pendingProfile && <div className="modal-overlay" role="presentation">
      <div className="modal-card google-username-modal" role="dialog" aria-modal="true" aria-labelledby="google-username-title" onKeyDown={(event) => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement) finishSignup(event); }}>
        <span className="eyebrow">One final privacy choice</span>
        <h2 id="google-username-title">Choose your public username</h2>
        <p>Signed in as <strong>{pendingProfile.name}</strong> ({pendingProfile.email}). Google does not provide a SecureChat username, so you stay in control of what others can search.</p>
        <label>Public username
          <input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} required minLength="3" maxLength="30" pattern="[A-Za-z0-9_]+" autoCapitalize="none" autoComplete="username" autoFocus />
          <span className="field-hint">3–30 letters, numbers, or underscores. Your email is never used for discovery.</span>
        </label>
        {error && <div className="error-banner" role="alert">⚠ {error}</div>}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={() => { setPendingProfile(null); credentialRef.current = ''; }}>Cancel</button>
          <button type="button" className="primary-button" disabled={loading || !username.trim()} onClick={finishSignup}>{loading ? 'Creating account…' : 'Create private account'}</button>
        </div>
      </div>
    </div>}
  </>;
}
