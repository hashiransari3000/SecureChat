const DATA_TABLE = [
  ['Username prefix', 'Account discovery', 'Suggestions start after 2 characters, are capped at 8, never use email, and respect discoverability'],
  ['Display name', 'Conversation identity', 'Shown in accepted chats and on requests you send'],
  ['Email', 'Login and recovery', 'Not exposed through discovery'],
  ['Phone (optional)', 'Recovery field', 'Not used for discovery'],
  ['Profile photo', 'Optional identity cue', 'Served through an authenticated privacy check; uploaded images are re-encoded to remove EXIF/GPS/camera metadata'],
  ['Message content', 'Communication', 'Encrypted in the browser with AES-256-GCM; MongoDB stores ciphertext plus per-device wrapped keys, not new-message plaintext'],
  ['Encrypted attachments', 'File / voice sharing', 'Encrypted before upload; the server receives opaque bytes without the original filename or MIME type'],
  ['Sent / delivered / read time', 'Delivery feedback', 'Metadata remains server-visible; read time exists only when the applicable participants allow read receipts'],
  ['Presence / typing signals', 'Live conversation feedback', 'Short-lived Socket.IO events; typing requires mutual opt-in and no last-seen history is kept'],
  ['Per-chat clear marker', 'Honor “Clear chat for me”', 'Stores only the account, conversation and clear time so older shared records stop being returned to that account; other participants are unaffected'],
  ['Privacy settings', 'Apply your choices', 'Stored so server-side enforcement cannot be bypassed by a different client'],
];

export default function DataTransparencyPage() {
  return <div className="page-shell transparency-page">
    <div className="page-heading"><div><span className="eyebrow">Transparency without fine print</span><h1>Your data</h1><p>A plain-language data map: what exists, why it exists, and what privacy boundary applies.</p></div></div>

    <section className="panel truth-card">
      <div className="section-title"><div><h2>Encryption boundary</h2><p>SecureChat separates what is encrypted from the metadata the service still needs to operate.</p></div><span className="status-pill positive">Browser E2EE</span></div>
      <div className="info-banner"><strong>New message content and attachment bytes are end-to-end encrypted between registered SecureChat browsers.</strong><p>Each message uses a fresh AES-256-GCM key that is wrapped to participant devices with RSA-OAEP. Browser private keys are non-extractable and are never uploaded.</p></div>
      <div className="warning-banner"><strong>This is not the Signal Protocol.</strong><p>This build does not provide Double Ratchet forward secrecy, sealed sender, or protection from a malicious server substituting public keys. Conversation membership, group names, timestamps and delivery metadata remain visible to this server. Device fingerprints are shown in chat so users can compare keys out-of-band.</p></div>
    </section>

    <section className="panel">
      <div className="section-title"><div><h2>Data inventory</h2><p>Data minimization starts by naming each data category and its purpose.</p></div></div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Data</th><th>Purpose</th><th>Privacy treatment</th></tr></thead><tbody>{DATA_TABLE.map((row) => <tr key={row[0]}>{row.map((cell) => <td key={cell}>{cell}</td>)}</tr>)}</tbody></table></div>
    </section>

    <section className="principle-grid">
      <article className="panel principle-card"><span>01</span><h2>Minimum disclosure</h2><p>New-person discovery returns a small set of username matches and withholds additional identity where possible until consent.</p></article>
      <article className="panel principle-card"><span>02</span><h2>Contextual consent</h2><p>Chat requests, microphone access and notification permission explain consequences before telemetry or browser permission begins.</p></article>
      <article className="panel principle-card"><span>03</span><h2>Purpose limitation</h2><p>Email is for account access, not people-search. Optional phone data is not turned into a public discovery channel.</p></article>
      <article className="panel principle-card"><span>04</span><h2>Retention control</h2><p>Disappearing messages can be set globally or per chat, and expired messages are removed from active UI state and MongoDB.</p></article>
    </section>

    <section className="panel"><h2>What this build deliberately does not collect or expose</h2><div className="chip-row"><span className="data-chip">No last-seen history</span><span className="data-chip">No email directory search</span><span className="data-chip">No partial username directory</span><span className="data-chip">No active analytics collector</span><span className="data-chip">No server-held E2EE private keys</span><span className="data-chip">No public avatar file URLs</span></div></section>
  </div>;
}
