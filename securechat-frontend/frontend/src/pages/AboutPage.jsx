import { Link } from 'react-router-dom';

export default function AboutPage() {
  return (
    <div className="page-shell narrow-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">About SecureChat</span>
          <h1>SecureChat</h1>
          <p>Privacy-first, open-source messaging that makes consent, transparency and data control a natural part of the experience.</p>
        </div>
      </div>
      <section className="panel">
        <h2>What this is</h2>
        <p className="muted">SecureChat is a self-hostable messaging platform where privacy is the default, not a buried setting. Every privacy control is presented at the moment it matters, with plain-language explanations and reversible actions — no dark patterns.</p>
        <div className="chip-row">
          <span className="data-chip">Consent first</span>
          <span className="data-chip">Privacy by default</span>
          <span className="data-chip">E2EE messaging</span>
          <span className="data-chip">Accessible controls</span>
        </div>
      </section>
      <section className="panel policy-sections">
        <details open>
          <summary>Privacy notice</summary>
          <p>The app stores account information, privacy preferences, conversation membership and delivery metadata needed to operate. Message and attachment content is end-to-end encrypted in the browser, so the server stores only protected ciphertext. The dedicated <Link to="/your-data">Your data</Link> page explains each category and limitation.</p>
        </details>
        <details>
          <summary>Terms of use</summary>
          <p>SecureChat is a self-hosted, open-source release, not an emergency or regulated communication service. Do not use it for safety-critical, financial, medical or legal communication. Do not misuse the service, impersonate others or share unlawful content.</p>
        </details>
        <details>
          <summary>Security scope</summary>
          <p>SecureChat uses browser-based end-to-end encryption and does not claim parity with mature, independently audited messengers. Technical limitations are disclosed transparently in the encryption and data pages rather than hidden.</p>
        </details>
      </section>
      <div className="action-row wrap">
        <Link className="secondary-button" to="/help">Help center</Link>
      </div>
    </div>
  );
}