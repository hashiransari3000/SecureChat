import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const { data } = await api.post('/auth/forgot-password', { email });
      setResult(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <img className="auth-logo" src="/securechat-logo-full.jpg" alt="SecureChat" />
        <h1>Reset your password</h1>
        <p className="auth-subtitle">Enter your email and we'll send you a reset link.</p>

        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>

        {error && <div className="error-banner">⚠ {error}</div>}
        {result && (
          <div className="info-banner">
            ✓ {result.message}
            {result.devResetLink && (
              <>
                <br />
                <small>
                  Dev mode (no email service connected) — use this link directly:{' '}
                  <a href={result.devResetLink}>{result.devResetLink}</a>
                </small>
              </>
            )}
          </div>
        )}

        <button type="submit" className="primary-button" disabled={loading}>
          {loading ? 'Sending…' : 'Send reset link'}
        </button>

        <p className="auth-switch">
          <Link to="/login">Back to login</Link>
        </p>
      </form>
    </div>
  );
}
