import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return <main className="auth-page" id="main-content">
    <section className="auth-card not-found-card" aria-labelledby="not-found-title">
      <span className="eyebrow">Error 404</span>
      <h1 id="not-found-title">This page is not available</h1>
      <p className="auth-subtitle">The link may be outdated. Your account and messages have not been changed.</p>
      <Link className="primary-button" to="/">Return to SecureChat</Link>
    </section>
  </main>;
}
