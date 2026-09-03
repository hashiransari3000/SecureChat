import { useState } from 'react';

export default function FeedbackPage() {
  const [type, setType] = useState('Usability issue');
  const [details, setDetails] = useState('');
  const [status, setStatus] = useState('');
  const prepare = async (event) => {
    event.preventDefault();
    const report = `SecureChat feedback\nType: ${type}\nDetails: ${details.trim()}\nPage: ${window.location.origin}`;
    try { await navigator.clipboard.writeText(report); setStatus('Report copied. Review it before sharing with your project team.'); }
    catch { setStatus('Report prepared below. Select and copy it when ready.'); }
  };
  return <div className="page-shell narrow-page"><div className="page-heading"><div><span className="eyebrow">Feedback without hidden collection</span><h1>Report a problem</h1><p>This academic build prepares a report locally. It does not silently upload chat content, device details or diagnostics.</p></div></div><form className="panel stack-form" onSubmit={prepare}><label>What kind of feedback?<select value={type} onChange={(e) => setType(e.target.value)}><option>Usability issue</option><option>Accessibility issue</option><option>Privacy concern</option><option>Bug</option><option>Suggestion</option></select></label><label>What happened?<textarea rows="6" required minLength="10" maxLength="1500" value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Describe what you expected, what happened, and what you tried." /><span className="field-hint">Do not include passwords, private messages or personal contact details.</span></label><button className="primary-button fit-button" disabled={details.trim().length < 10}>Prepare & copy report</button>{status && <div className="success-banner" role="status">✓ {status}</div>}{status && <textarea className="prepared-report" readOnly value={`SecureChat feedback\nType: ${type}\nDetails: ${details.trim()}\nPage: ${window.location.origin}`} aria-label="Prepared feedback report" />}</form></div>;
}
