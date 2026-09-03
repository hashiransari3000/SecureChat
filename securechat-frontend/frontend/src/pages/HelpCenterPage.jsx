import { Link } from 'react-router-dom';

const FAQ = [
  ['How do I start a chat?', 'Type at least 2 characters of the username and choose a suggestion. The other person receives a request and no presence, typing or read activity is shared until they accept.'],
  ['What does end-to-end encrypted mean here?', 'Message and attachment content is protected between registered browsers. Open the lock badge in a chat for a simple summary and optional advanced verification.'],
  ['Why can’t I see Seen or typing?', 'These are mutual-consent signals. They appear only when both people permit the relevant setting.'],
  ['What does Clear chat do?', 'It hides existing history from your account only. It does not erase another participant’s history, block them or stop future messages.'],
  ['How do disappearing messages work?', 'Choose a timer in conversation options. It applies to new messages and the interface confirms the change.'],
];

export default function HelpCenterPage() {
  return <div className="page-shell narrow-page"><div className="page-heading"><div><span className="eyebrow">Help & support</span><h1>How can we help?</h1><p>Short answers for the most important tasks and privacy choices.</p></div></div><section className="panel faq-list">{FAQ.map(([question,answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</section><section className="panel"><h2>Still stuck?</h2><p className="muted">Use the problem-report helper to prepare a clear report without automatically sending private chat content.</p><div className="action-row wrap"><Link className="primary-button" to="/feedback">Report a problem</Link><Link className="secondary-button" to="/settings">Open settings</Link></div></section></div>;
}
