import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { login, loading, error } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    const ok = await login(form);
    if (ok) navigate('/');
  };

  return (
    <main className="auth-page" id="main-content">
      <form className="auth-card" onSubmit={handleSubmit}>
        <img className="auth-logo" src="/securechat-logo-full.jpg" alt="SecureChat" />
        <h1>Welcome back</h1>

        <label>
          Email
          <input type="email" name="email" value={form.email} onChange={handleChange} required autoComplete="email" inputMode="email" autoFocus />
        </label>

        <label>
          Password
          <div className="password-field">
            <input
              type={showPassword ? 'text' : 'password'}
              name="password"
              value={form.password}
              onChange={handleChange}
              required
              autoComplete="current-password"
            />
            <button type="button" className="link-button" onClick={() => setShowPassword((s) => !s)}>
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>

        <Link to="/forgot-password" className="forgot-link">
          Forgot password?
        </Link>

        {error && <div className="error-banner" role="alert">⚠ {error}</div>}

        <button type="submit" className="primary-button" disabled={loading}>
          {loading ? 'Logging in…' : 'Log in'}
        </button>

        <p className="auth-switch">
          Don't have an account? <Link to="/signup">Sign up</Link>
        </p>
      </form>
    </main>
  );
}
