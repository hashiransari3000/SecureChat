const HCI = [
  ['Learnability', 'Plain language, familiar chat patterns, visible labels and progressive disclosure keep common tasks simple while advanced verification remains available.'],
  ['Flexibility', 'Privacy settings, message retention, text size, contrast, motion and notification detail adapt to different user needs.'],
  ['Robustness', 'Connection state, delivery state, confirmations, recovery copy and explicit errors keep the system observable and recoverable.'],
  ['Consistency', 'The same button hierarchy, terminology, status badges and interaction patterns are reused throughout the application.'],
  ['User control & freedom', 'Users can decline requests, cancel outgoing requests, turn off social telemetry, block contacts, export data and back out of destructive actions.'],
  ['Error prevention', 'Permanent deletion requires password verification plus DELETE; request/message actions explain consequences before irreversible changes.'],
  ['Visibility of system status', 'Socket connection, online/hidden presence, typing, sent/delivered/seen, expiry and save states are visible at the point of action.'],
  ['Universal design', 'Keyboard focus, accessible labels, larger targets, responsive layout, high contrast, text-size choice and reduced motion are supported.'],
];


const LECTURE_RULES = [
  ['Learnability', ['Predictability', 'Synthesizability', 'Familiarity', 'Generalizability', 'Consistency']],
  ['Flexibility', ['Dialog initiative', 'Multithreading', 'Task migratability', 'Substitutivity', 'Customizability']],
  ['Robustness', ['Observability', 'Recoverability', 'Responsiveness', 'Task conformance']],
];

const SHNEIDERMAN = [
  ['Strive for consistency', 'Shared button hierarchy, labels, cards, menus and status language across every screen.'],
  ['Enable frequent users to use shortcuts', 'Chat-header profile actions provide one-tap Search, Encryption and Clear Chat; Enter sends while Shift+Enter adds a line.'],
  ['Offer informative feedback', 'Connection, encryption, typing, delivery, save, upload, loading, success and error states appear where actions happen.'],
  ['Design dialog to yield closure', 'Requests, profile saves, privacy changes, clear chat, blocking, leaving and logout end with an explicit result or dismissal.'],
  ['Offer error prevention and simple handling', 'Input constraints, disabled unsafe actions, contextual permission prompts and plain-language recovery messages prevent common mistakes.'],
  ['Permit easy reversal of action', 'Drafts and edits can be cancelled, settings can be changed back, contacts can be unblocked and destructive actions provide a safe Cancel path.'],
  ['Support internal locus of control', 'Users initiate permissions and decide discovery, social signals, retention, appearance, exports and deletion without forced sharing.'],
  ['Reduce short-term memory load', 'Visible labels, previews, Settings task groups, Help answers, inline consequences and recognition-based choices avoid memorized commands.'],
];
const NORMAN = ['Use knowledge in the world and the head', 'Simplify task structure', 'Make things visible', 'Get mappings right', 'Exploit constraints', 'Design for error', 'Standardize when needed'];

const ETHICS = [
  ['Data minimization', 'Prefix lookup is capped, excludes email, and respects incognito; no last-seen history is retained.'],
  ['Granular consent', 'Presence, read receipts, typing, profile visibility, notifications, analytics and retention are separate choices rather than one blanket permission.'],
  ['Transparency', 'The UI distinguishes browser E2EE content protection from server-visible metadata and explicitly states that this is not the Signal Protocol or a Double-Ratchet implementation.'],
  ['Data sovereignty', 'Encrypted export, retention controls, image metadata stripping and password-confirmed hard deletion give users practical control over data.'],
  ['Privacy by default', 'Profile photos default to Connections Only, notifications are off until contextual permission, and analytics collection is not active.'],
  ['No dark patterns', 'Privacy-protective and privacy-sharing choices use comparable visual weight; cancellation remains visible; destructive actions are not rushed.'],
  ['Proportionate disclosure', 'Encryption opens with a plain-language protected/service-visible summary; technical algorithms and device fingerprints appear only when Advanced verification is requested.'],
];

export default function DesignEthicsPage() {
  return <div className="page-shell ethics-page">
    <div className="page-heading"><div><span className="eyebrow">Course evidence</span><h1>HCI & Data Ethics implementation map</h1><p>This page connects the working interface to the principles covered in the supplied HCI lectures so the design rationale is inspectable during a viva.</p></div></div>
    <section className="panel"><div className="section-title"><div><h2>HCI principles in the product</h2><p>Based on the lecture themes around learnability, flexibility, robustness, Norman/Shneiderman-style design rules, evaluation and universal design.</p></div></div><div className="evidence-grid">{HCI.map(([title,text]) => <article className="evidence-card" key={title}><h3>{title}</h3><p>{text}</p></article>)}</div></section>
    <section className="panel lecture-map"><div className="section-title"><div><h2>Design Rules lecture — explicit coverage</h2><p>The named principles are mapped to working interface evidence so the implementation can be defended directly during the viva.</p></div></div><div className="lecture-rule-grid">{LECTURE_RULES.map(([group, items]) => <article key={group}><h3>{group}</h3><div className="chip-row">{items.map((item) => <span className="data-chip lecture-chip" key={item}>{item}</span>)}</div></article>)}</div><div className="golden-rules"><h3>Shneiderman’s Eight Golden Rules — applied evidence</h3><ol>{SHNEIDERMAN.map(([rule,evidence]) => <li key={rule}><strong>{rule}</strong><p>{evidence}</p></li>)}</ol></div><div className="rule-columns"><div><h3>Norman’s design principles</h3><ol>{NORMAN.map((item) => <li key={item}>{item}</li>)}</ol></div></div></section>
    <section className="panel"><div className="section-title"><div><h2>Data ethics in UX/UI</h2><p>The interface treats privacy as an interaction-design property, not a paragraph in a policy page.</p></div></div><div className="evidence-grid ethics-grid">{ETHICS.map(([title,text]) => <article className="evidence-card" key={title}><h3>{title}</h3><p>{text}</p></article>)}</div></section>
    <section className="panel demo-checklist"><h2>Fast viva demo path</h2><ol><li>Type the first 2 characters of a username, choose a limited suggestion, and send a consent-first chat request.</li><li>Accept it in the second browser and show Delivered / Seen plus mutual typing and online status.</li><li>Turn read receipts or typing off on either account and show the signal disappear.</li><li>Switch profile photo to Connections Only and demonstrate the privacy placeholder for non-connections.</li><li>Change disappearing messages and show the in-chat system event.</li><li>Open About encryption: explain the plain-language summary, then expand Advanced verification to compare safe-to-share fingerprints and explain the honest E2EE boundary.</li><li>Use Clear chat for me to demonstrate informed confirmation, individual control, and why one user cannot erase another participant’s history.</li><li>Open Profile and explain EXIF stripping; then open Data Control and show password-protected deletion.</li></ol></section>
  </div>;
}
