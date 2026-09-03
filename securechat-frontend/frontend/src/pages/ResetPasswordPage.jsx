import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import api from '../api/client';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';
  const email = searchParams.get('email') || '';

  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post('/auth/reset-password', { email, token, newPassword });
      setDone(true);
      setTimeout(() => navigate('/login'), 2000);
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!token || !email) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <img className="auth-logo" src="/securechat-logo-full.jpg" alt="SecureChat" />
          <h1>Invalid reset link</h1>
          <p>This link is missing required information. Please request a new one.</p>
          <Link to="/forgot-password">Request a new link</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <img className="auth-logo" src="/securechat-logo-full.jpg" alt="SecureChat" />
        <h1>Choose a new password</h1>

        <label>
          New password
          <div className="password-field">
            <input
              type={showPassword ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
            <button type="button" className="link-button" onClick={() => setShowPassword((s) => !s)}>
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          <span className="field-hint">At least 8 characters.</span>
        </label>

        {error && <div className="error-banner">⚠ {error}</div>}
        {done && <div className="info-banner">✓ Password reset. Redirecting to login…</div>}

        <button type="submit" className="primary-button" disabled={loading || done}>
          {loading ? 'Saving…' : 'Reset password'}
        </button>
      </form>
    </div>
  );
}
