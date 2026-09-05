import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PrivacyProvider, usePrivacy } from '../context/PrivacyContext';
import { E2EEProvider, useE2EE } from '../context/E2EEContext';
import PrivacyTour from './PrivacyTour';
import AppLock from './AppLock';
import Avatar from './Avatar';
import { ArrowLeft, LockKeyhole, MessageCircle, MoonStar, MoreHorizontal, Settings, ShieldCheck } from 'lucide-react';

function SecureShell({ user, logout }) {
  const { settings, updateField } = usePrivacy();
  const { status: cryptoStatus } = useE2EE();
  const [showTour, setShowTour] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [authNotice, setAuthNotice] = useState(() => sessionStorage.getItem('securechat_auth_notice') || '');
  const userId = user?.id || user?._id;
  const textSize = settings?.textSize || 'medium';
  const highContrast = !!settings?.highContrast;
  const reducedMotion = !!settings?.reducedMotion;
  const theme = settings?.theme || 'light';
  const settingsReady = settings !== null;
  const menuRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => { setMenuOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!authNotice) return undefined;
    sessionStorage.removeItem('securechat_auth_notice');
    const timer = window.setTimeout(() => setAuthNotice(''), 3600);
    return () => window.clearTimeout(timer);
  }, [authNotice]);
  useEffect(() => {
    if (!userId) return;
    const key = `securechat_seen_tour_${userId}`;
    if (!localStorage.getItem(key)) setShowTour(true);
  }, [userId]);

  useEffect(() => {
    if (!settingsReady) return;
    const root = document.documentElement;
    const nextTextSize = textSize;
    const nextContrast = highContrast ? 'true' : 'false';
    const nextMotion = reducedMotion ? 'true' : 'false';
    if (root.dataset.textSize !== nextTextSize) root.dataset.textSize = nextTextSize;
    if (root.dataset.highContrast !== nextContrast) root.dataset.highContrast = nextContrast;
    if (root.dataset.reducedMotion !== nextMotion) root.dataset.reducedMotion = nextMotion;
  }, [settingsReady, textSize, highContrast, reducedMotion]);

  useEffect(() => {
    if (!settingsReady) return undefined;
    const root = document.documentElement;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const nextTheme = theme === 'system' ? (query.matches ? 'dark' : 'light') : theme;
      if (root.dataset.theme !== nextTheme) root.dataset.theme = nextTheme;
    };
    applyTheme();
    query.addEventListener?.('change', applyTheme);
    return () => query.removeEventListener?.('change', applyTheme);
  }, [settingsReady, theme]);

  useEffect(() => {
    const close = (event) => { if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false); };
    const escape = (event) => { if (event.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, []);

  const dismissTour = () => {
    if (userId) localStorage.setItem(`securechat_seen_tour_${userId}`, '1');
    setShowTour(false);
  };

  const quickTheme = async () => {
    const current = document.documentElement.dataset.theme;
    await updateField('theme', current === 'dark' ? 'light' : 'dark');
  };

  return <>
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <div className="app-shell">
      <header className="top-nav">
        <NavLink className="brand" to="/" aria-label="SecureChat home">
          <span className="brand-logo-frame" aria-hidden="true"><img src="/securechat-logo-icon.jpg" alt="" /></span>
          <span className="brand-name">SecureChat</span>
        </NavLink>
        <nav className="nav-links" aria-label="Primary navigation">
          <NavLink to="/" end title="Chats"><MessageCircle aria-hidden="true" /><span>Chats</span></NavLink>
          <NavLink to="/privacy" title="Privacy center"><ShieldCheck aria-hidden="true" /><span>Privacy</span></NavLink>
          <NavLink to="/settings" title="Settings"><Settings aria-hidden="true" /><span>Settings</span></NavLink>
        </nav>
        <div className="nav-user">
          <span className={`crypto-dot ${cryptoStatus}`} title={cryptoStatus === 'ready' ? 'This browser is registered for encrypted messaging' : 'Encryption device status'} aria-label={`Encryption device ${cryptoStatus}`} />
          <button className="icon-button top-icon" type="button" onClick={quickTheme} title="Toggle light/dark appearance" aria-label="Toggle light or dark appearance"><MoonStar aria-hidden="true" /></button>
          {settings?.appLockTimeout !== 'off' && <button className="icon-button top-icon" type="button" onClick={() => window.dispatchEvent(new Event('securechat:lock-now'))} title="Lock this browser now" aria-label="Lock SecureChat now"><LockKeyhole aria-hidden="true" /></button>}
          <div className="overflow-menu" ref={menuRef}>
            <button className="icon-button top-icon" type="button" aria-label="More SecureChat options" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}><MoreHorizontal aria-hidden="true" /></button>
            {menuOpen && <div className="menu-popover" role="menu">
              <NavLink role="menuitem" to="/profile">Profile & account</NavLink>
              <NavLink role="menuitem" to="/settings">Settings</NavLink>
              <NavLink role="menuitem" to="/privacy">Privacy, notifications & accessibility</NavLink>
              <NavLink role="menuitem" to="/your-data">Your data</NavLink>
              <div className="menu-divider" />
              <NavLink role="menuitem" to="/help">Help center</NavLink>
              <NavLink role="menuitem" to="/feedback">Feedback / report a problem</NavLink>
              <NavLink role="menuitem" to="/about">About, terms & privacy</NavLink>
              <NavLink role="menuitem" className="project-notes-link" to="/design-ethics">HCI design evidence</NavLink>
              <div className="menu-divider" />
              <button role="menuitem" className="danger-menu-item" type="button" onClick={() => { setMenuOpen(false); setConfirmLogout(true); }}>Log out</button>
            </div>}
          </div>
          <NavLink to="/profile" className="rail-account" title={`Logged in as @${user?.username}`} aria-label={`Profile — logged in as @${user?.username}`}><Avatar user={user} size="xs" /><span>Profile</span></NavLink>
        </div>
      </header>
      <main className={`app-content ${location.pathname === '/' ? 'chat-route' : ''}`} id="main-content" tabIndex="-1">
        <div className="route-stage" key={location.pathname}>
          {location.pathname !== '/' && <button className="page-back-button" type="button" onClick={() => window.history.length > 1 ? navigate(-1) : navigate('/')}><ArrowLeft aria-hidden="true" /> Back</button>}
          <Outlet />
        </div>
      </main>
    </div>
    {showTour && <PrivacyTour onDone={dismissTour} />}
    {authNotice && <div className="toast auth-welcome-toast" role="status" aria-live="polite">✓ {authNotice}</div>}
    {settings && userId && <AppLock userId={userId} timeout={settings.appLockTimeout} />}
    {confirmLogout && <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="logout-title"><div className="modal-card compact-card"><h2 id="logout-title">Log out of SecureChat?</h2><p>Your local encrypted-browser identity remains on this device so this browser can read messages again after you log back in.</p><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setConfirmLogout(false)}>Stay logged in</button><button className="danger-button" type="button" onClick={logout}>Log out</button></div></div></div>}
  </>;
}

function ProtectedShell({ user, logout }) {
  return <PrivacyProvider><E2EEProvider><SecureShell user={user} logout={logout} /></E2EEProvider></PrivacyProvider>;
}

export default function AppLayout() {
  const { token, user, logout, initializing } = useAuth();
  if (initializing) return <div className="shell-skeleton" role="status" aria-live="polite" aria-label="Restoring your session"><aside><span className="skeleton-block skeleton-logo" />{[1,2,3,4].map((item) => <span className="skeleton-block skeleton-nav" key={item} />)}</aside><main><span className="skeleton-block skeleton-title" /><span className="skeleton-block skeleton-line" /><div className="skeleton-panel"><span className="skeleton-block" /><span className="skeleton-block" /><span className="skeleton-block" /></div></main></div>;
  if (!token || !user) return <Navigate to="/login" replace />;
  return <ProtectedShell user={user} logout={logout} />;
}
