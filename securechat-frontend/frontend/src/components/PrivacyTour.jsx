import { useState } from 'react';

const SLIDES = [
  { title: 'Privacy choices stay visible', body: 'Discovery, profile photo visibility, presence, typing, read receipts, notifications and message retention are grouped in one Privacy screen with plain-language consequences.' },
  { title: 'Consent comes before telemetry', body: 'New contacts begin as Chat Requests. Delivery, seen, typing and presence sharing do not begin until the request is accepted, and mutual signals respect both people’s settings.' },
  { title: 'Encryption with honest boundaries', body: 'Message content and attachments are protected between registered browsers. SecureChat also clearly identifies the service-visible information needed to route messages, with optional advanced details for people who want them.' },
  { title: 'Your data stays actionable', body: 'You can export an encrypted archive, control retention, block contacts, or permanently delete your account after an explicit password confirmation.' },
];

export default function PrivacyTour({ onDone }) {
  const [step, setStep] = useState(0);
  const slide = SLIDES[step];
  const isLast = step === SLIDES.length - 1;
  return <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="tour-title">
    <div className="modal-card tour-card">
      <div className="tour-progress" role="progressbar" aria-valuemin="1" aria-valuemax={SLIDES.length} aria-valuenow={step + 1} aria-label={`Step ${step + 1} of ${SLIDES.length}`}>{SLIDES.map((_, i) => <span key={i} className={`tour-dot ${i === step ? 'active' : ''}`} />)}</div>
      <span className="eyebrow">Privacy-first onboarding</span>
      <h2 id="tour-title">{slide.title}</h2><p>{slide.body}</p>
      <div className="tour-actions"><button className="link-button" onClick={onDone}>Skip tour</button>{step > 0 && <button className="secondary-button" onClick={() => setStep((s) => s - 1)}>Back</button>}<button className="primary-button" autoFocus onClick={() => isLast ? onDone() : setStep((s) => s + 1)}>{isLast ? 'Start securely' : 'Next'}</button></div>
    </div>
  </div>;
}
