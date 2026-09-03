import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function SignupPage() {
  const { signup, loading, error } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', username: '', email: '', password: '', phone: '' });
  const [showPassword, setShowPassword] = useState(false);
  const passwordChecks = [form.password.length >= 8, /[A-Za-z]/.test(form.password), /\d/.test(form.password)];
  const passwordReady = passwordChecks.every(Boolean);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    const ok = await signup(form);
    if (ok) navigate('/');
  };

  return (
    <main className="auth-page" id="main-content">
      <form className="auth-card" onSubmit={handleSubmit}>
        <img className="auth-logo" src="/securechat-logo-full.jpg" alt="SecureChat" />
        <h1>Create your account</h1>
        <p className="auth-subtitle">You choose what identifies you publicly. Your email is never used for discovery.</p>

        <label>Full name
          <input name="name" value={form.name} onChange={handleChange} required autoComplete="name" autoFocus />
        </label>

        <label>Username
          <input name="username" value={form.username} onChange={handleChange} required autoCapitalize="none" autoComplete="username" minLength="3" maxLength="30" pattern="[A-Za-z0-9_]+" />
          <span className="field-hint">3–30 letters, numbers, or underscores. If discoverable, you may appear in limited prefix suggestions.</span>
        </label>

        <label>Email
          <input type="email" name="email" value={form.email} onChange={handleChange} required autoComplete="email" inputMode="email" />
          <span className="field-hint">Used for login and recovery; not shown in user search.</span>
        </label>

        <label>Password
          <div className="password-field">
            <input type={showPassword ? 'text' : 'password'} name="password" value={form.password} onChange={handleChange} required autoComplete="new-password" minLength="8" aria-describedby="password-guidance" />
            <button type="button" className="link-button" onClick={() => setShowPassword((s) => !s)}>{showPassword ? 'Hide' : 'Show'}</button>
          </div>
          <span className="field-hint" id="password-guidance">Use 8+ characters with at least one letter and one number.</span>
          {form.password && <span className={`password-meter ${passwordReady ? 'ready' : ''}`} role="status">{passwordReady ? 'Strong enough to continue' : `${passwordChecks.filter(Boolean).length} of 3 password checks met`}</span>}
        </label>

        <label>Phone <span className="optional-tag">Optional — recovery only</span>
          <input name="phone" value={form.phone} onChange={handleChange} autoComplete="tel" inputMode="tel" />
        </label>

        {error && <div className="error-banner" role="alert">⚠ {error}</div>}
        <button type="submit" className="primary-button" disabled={loading || !passwordReady}>{loading ? 'Creating account…' : 'Create private account'}</button>
        <p className="auth-switch">Already have an account? <Link to="/login">Log in</Link></p>
      </form>
    </main>
  );
}
