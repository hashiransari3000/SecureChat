import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '432304486079-mdgpiraqhiciv9neskk5f34th6ib5ejl.apps.googleusercontent.com';

const isNative = typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();

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
  const nativeGoogleRef = useRef(null);
  const [pendingProfile, setPendingProfile] = useState(null);
  const [username, setUsername] = useState('');
  const [nativeReady, setNativeReady] = useState(false);

  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  useEffect(() => {
    if (isNative) {
      let cancelled = false;
      import('@capawesome/capacitor-google-sign-in')
        .then(async ({ GoogleSignIn }) => {
          if (cancelled) return;
          nativeGoogleRef.current = GoogleSignIn;
          await GoogleSignIn.initialize({ clientId: GOOGLE_CLIENT_ID });
          if (!cancelled) setNativeReady(true);
        })
        .catch(() => setError('Google Sign-In could not start on this device. Try email and password.'));
      return () => { cancelled = true; };
    }

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

  const nativeSignIn = async () => {
    if (!nativeGoogleRef.current || loading) return;
    try {
      const result = await nativeGoogleRef.current.signIn();
      credentialRef.current = result.idToken;
      const loginResult = await loginWithGoogle(result.idToken);
      if (loginResult.ok) onCompleteRef.current();
      else if (loginResult.needsUsername) {
        setPendingProfile(loginResult.profile);
        setUsername(loginResult.profile.suggestedUsername || '');
      }
    } catch (err) {
      if (err?.code === 'SIGN_IN_CANCELED') setError('Google Sign-In was cancelled.');
      else if (err?.code === 'NO_CREDENTIAL_AVAILABLE') setError('No Google account is available on this device. Add one in device Settings and try again.');
      else setError('Google Sign-In could not start. Try again or use email and password.');
    }
  };

  const finishSignup = async (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (loading || !username.trim()) return;
    const result = await loginWithGoogle(credentialRef.current, username);
    if (result.ok) { setPendingProfile(null); onCompleteRef.current(); }
  };

  return <>
    <div className="auth-divider" aria-hidden="true"><span>or continue with</span></div>
    {isNative ? (
      <button type="button" className="secondary-button google-native-button" onClick={nativeSignIn} disabled={loading || !nativeReady}>
        <svg className="google-native-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
          <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
        </svg>
        {loading ? 'Signing in…' : 'Continue with Google'}
      </button>
    ) : (
      <div className="google-signin-wrap" ref={buttonRef} aria-label="Continue with Google" />
    )}
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
