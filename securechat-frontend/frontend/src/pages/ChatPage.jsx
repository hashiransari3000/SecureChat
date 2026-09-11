import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, FileText, Info, KeyRound, LockKeyhole, MessageCirclePlus, Mic, Monitor, MoreHorizontal, Paperclip, Play, Search, Send, ShieldCheck, Smile, Timer, Trash2 } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/useSocket';
import { usePrivacy } from '../context/PrivacyContext';
import { useE2EE } from '../context/E2EEContext';
import Avatar from '../components/Avatar';
import EmojiMenu from '../components/EmojiMenu';
import { isNativePlatform, onNotificationTap, showMessageNotification } from '../utils/notifications';
import { initializePushNotifications } from '../utils/push';

const MODES = [['off', 'Off'], ['1h', '1 hour'], ['1d', '1 day'], ['7d', '7 days']];
const USERNAME_PREFIX = /^[a-z0-9_]{2,30}$/i;
const MAX_ATTACHMENT_BYTES = 24 * 1024 * 1024;

function idOf(value) { return String(value?._id || value?.id || value || ''); }
function timeLabel(value) { if (!value) return ''; return new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
function dateTimeLabel(value) { if (!value) return ''; return new Intl.DateTimeFormat([], { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
function dayLabel(value) { const date = new Date(value); const today = new Date(); const yesterday = new Date(); yesterday.setDate(today.getDate() - 1); if (date.toDateString() === today.toDateString()) return 'Today'; if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'; return new Intl.DateTimeFormat([], { month: 'long', day: 'numeric', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' }).format(date); }
function bytesLabel(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 ** 2)).toFixed(1)} MB`;
}
function expiryLabel(value, now) {
  if (!value) return null;
  const left = new Date(value).getTime() - now;
  if (left <= 0) return 'Expired';
  if (left < 60_000) return 'Disappears in <1 min';
  if (left < 3_600_000) return `Disappears in ${Math.ceil(left / 60_000)} min`;
  if (left < 86_400_000) return `Disappears in ${Math.ceil(left / 3_600_000)} hr`;
  return `Disappears in ${Math.ceil(left / 86_400_000)} d`;
}
function messageStatus(message, isGroup) {
  if (message.readAt) return { icon: '✓✓', label: isGroup ? 'Seen by all eligible members' : 'Seen', className: 'seen' };
  if (message.deliveredAt) return { icon: '✓✓', label: isGroup ? 'Delivered to all active members' : 'Delivered', className: 'delivered' };
  return { icon: '✓', label: 'Sent to server', className: 'sent' };
}
function GroupAvatar({ name, size = 'sm' }) {
  const initials = String(name || 'Group').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join('') || 'G';
  return <span className={`avatar avatar-${size} group-avatar`} role="img" aria-label={`${name || 'Group'} group`}>{initials}</span>;
}
function peerFor(conversation, myId) { return conversation?.participantIds?.find((p) => idOf(p) !== myId); }
function presenceLabel(state) { return state === 'online' ? 'Online' : state === 'hidden' ? 'Presence hidden' : state === 'offline' ? 'Offline' : 'Status unavailable'; }
function participantName(conversation, userId) {
  const person = conversation?.participantIds?.find((p) => idOf(p) === idOf(userId));
  return person?.name || person?.username || 'Member';
}
function chatTitle(conversation, myId) {
  if (!conversation) return 'SecureChat';
  if (conversation.type === 'group') return conversation.name || 'Private group';
  const peer = peerFor(conversation, myId);
  return peer?.name || peer?.username || 'Account unavailable';
}
function contentPreview(content) {
  if (!content) return 'Encrypted message';
  if (content.kind === 'voice') return '🎙 Voice note';
  if (content.kind === 'attachment') return `📎 ${content.attachment?.name || 'Attachment'}`;
  return String(content.text || 'Message').replace(/\s+/g, ' ').slice(0, 90);
}
function groupReactions(reactions, myId) {
  const map = new Map();
  for (const reaction of reactions || []) {
    const entry = map.get(reaction.emoji) || { emoji: reaction.emoji, count: 0, mine: false };
    entry.count += 1;
    if (idOf(reaction.userId) === idOf(myId)) entry.mine = true;
    map.set(reaction.emoji, entry);
  }
  return [...map.values()].sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0) || String(a.emoji).localeCompare(String(b.emoji)));
}

function ConfirmDialog({ title, children, confirmLabel, danger = false, onConfirm, onCancel }) {
  return <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
    <div className="modal-card compact-card">
      <h2 id="confirm-title">{title}</h2>
      <div className="modal-copy">{children}</div>
      <div className="modal-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        <button type="button" className={danger ? 'danger-button' : 'primary-button'} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </div>
  </div>;
}

function RequestComposer({ target, encryptForUser, onClose, onSent }) {
  const [intro, setIntro] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async (event) => {
    event.preventDefault();
    const text = intro.trim();
    if (!text) return setError('Write a short introduction so the recipient can make an informed choice.');
    setBusy(true); setError('');
    try {
      const initialEnvelope = await encryptForUser(target.id, { kind: 'text', text });
      await api.post('/conversations', { otherUserId: target.id, initialEnvelope });
      onSent();
    } catch (e) { setError(e.response?.data?.error || e.message || 'Could not send this chat request.'); }
    finally { setBusy(false); }
  };
  return <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="request-title">
    <form className="modal-card request-modal" onSubmit={send}>
      <span className="eyebrow">Consent-first connection</span>
      <h2 id="request-title">Request chat with @{target.username}</h2>
      <div className="request-target"><Avatar user={target} hidden={target.avatarPlaceholder} size="lg" /><div><strong>@{target.username}</strong><p>{target.name || 'Their display identity is intentionally limited before connection acceptance.'}</p></div></div>
      <label>Your introduction
        <textarea autoFocus value={intro} onChange={(e) => setIntro(e.target.value.slice(0, 500))} maxLength={500} rows={4} placeholder="Hi — can we chat here?" />
        <span className="field-hint">{intro.length}/500 · Encrypted for both browsers. No further message can be sent until they accept.</span>
      </label>
      <div className="privacy-explainer"><span aria-hidden="true"><ShieldCheck /></span><div><strong>They stay private until they accept.</strong><p>Read receipts, online status, and typing indicators are hidden from them until they accept your request.</p></div></div>
      {error && <div className="error-banner" role="alert">⚠ {error}</div>}
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button><button className="primary-button" disabled={busy || !intro.trim()}>{busy ? 'Encrypting & sending…' : 'Send request'}</button></div>
    </form>
  </div>;
}

function GroupComposer({ conversations, myId, onClose, onCreated }) {
  const contacts = useMemo(() => conversations.filter((c) => c.type === 'direct' && c.messagingAvailable).map((c) => peerFor(c, myId)).filter(Boolean), [conversations, myId]);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toggle = (personId) => setSelected((prev) => prev.includes(personId) ? prev.filter((x) => x !== personId) : [...prev, personId]);
  const submit = async (event) => {
    event.preventDefault();
    if (name.trim().length < 2) return setError('Give the group a name of at least 2 characters.');
    if (!selected.length) return setError('Choose at least one accepted connection.');
    setBusy(true); setError('');
    try {
      const { data } = await api.post('/groups', { name: name.trim(), participantIds: selected });
      onCreated(data);
    } catch (e) { setError(e.response?.data?.error || 'Could not create the group.'); }
    finally { setBusy(false); }
  };
  return <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="group-title">
    <form className="modal-card group-modal" onSubmit={submit}>
      <span className="eyebrow">Consent-aware group</span><h2 id="group-title">Create a private group</h2>
      <p className="muted">Only accepted connections can be invited. Invitees must accept before they start receiving group messages or seeing typing and delivery status.</p>
      <label>Group name<input value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} placeholder="Project Team" maxLength={60} autoFocus /></label>
      <fieldset className="member-picker"><legend>Invite connections</legend>
        {contacts.length === 0 ? <div className="empty-inline">Accept at least one direct chat before creating a group.</div> : contacts.map((person) => <label className="member-option" key={idOf(person)}><input type="checkbox" checked={selected.includes(idOf(person))} onChange={() => toggle(idOf(person))} /><Avatar user={person} size="xs" /><span><strong>{person.name || person.username}</strong><small>@{person.username}</small></span></label>)}
      </fieldset>
      <div className="privacy-explainer"><span aria-hidden="true"><LockKeyhole /></span><div><strong>Group content is encrypted before it leaves your browser.</strong><p>The service can see the group name and membership so it can deliver messages, but it cannot directly read the protected message or attachment content.</p></div></div>
      {error && <div className="error-banner" role="alert">⚠ {error}</div>}
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button><button className="primary-button" disabled={busy || !selected.length}>{busy ? 'Creating…' : `Create group${selected.length ? ` · ${selected.length + 1} members` : ''}`}</button></div>
    </form>
  </div>;
}

function MicrophoneExplainer({ onCancel, onContinue }) {
  return <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="mic-title">
    <div className="modal-card compact-card permission-card">
      <div className="permission-icon" aria-hidden="true"><Mic /></div><span className="eyebrow">Just-in-time permission</span><h2 id="mic-title">Record a voice note?</h2>
      <p>SecureChat needs microphone access only while you record. Audio is captured in this browser, then encrypted before upload. The server receives encrypted bytes, not playable audio.</p>
      <div className="privacy-explainer"><span aria-hidden="true"><Check /></span><div><strong>You stay in control.</strong><p>The browser permission appears only after you choose Continue. You can stop, review, send, or discard the recording.</p></div></div>
      <div className="modal-actions"><button className="secondary-button" type="button" onClick={onCancel}>Not now</button><button className="primary-button" type="button" onClick={onContinue}>Continue to browser permission</button></div>
    </div>
  </div>;
}

function EncryptionInfo({ active, myId, identity, onClose }) {
  const [devices, setDevices] = useState(null);
  const [error, setError] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  useEffect(() => {
    if (!advancedOpen || devices) return undefined;
    let cancelled = false;
    api.get(`/crypto/conversations/${idOf(active)}/recipients`).then(({ data }) => { if (!cancelled) setDevices(data.participants || []); }).catch((e) => { if (!cancelled) setError(e.response?.data?.error || 'Could not load device fingerprints.'); });
    return () => { cancelled = true; };
  }, [active, advancedOpen, devices]);
  return <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="encryption-title">
    <div className="modal-card encryption-modal">
      <span className="eyebrow">Conversation security</span><h2 id="encryption-title">Your message content is protected</h2>
      <p className="muted">Messages, attachments and voice notes are encrypted in your browser and can be opened by registered browsers in this conversation.</p>
      <div className="security-summary-grid">
        <div className="security-summary protected"><span aria-hidden="true"><Check /></span><div><strong>Protected</strong><p>Message text, files and voice-note content.</p></div></div>
        <div className="security-summary metadata"><span aria-hidden="true"><Info /></span><div><strong>Service-visible</strong><p>Participants, timestamps, group name and delivery information.</p></div></div>
      </div>
      <button className="advanced-toggle" type="button" aria-expanded={advancedOpen} aria-controls="advanced-encryption-details" onClick={() => setAdvancedOpen((open) => !open)}><span>{advancedOpen ? 'Hide' : 'Advanced'} verification details</span><span aria-hidden="true">{advancedOpen ? '⌃' : '⌄'}</span></button>
      {advancedOpen && <div id="advanced-encryption-details" className="advanced-security-panel">
        <h3>Verify registered browsers</h3>
        <p className="microcopy"><strong>Fingerprints are not passwords or private keys.</strong> They are safe-to-compare identity codes. Compare them with the other person through a trusted channel if you need stronger identity assurance.</p>
        <div className="device-list">
          <div className="device-row"><span><Monitor aria-hidden="true" /></span><div><strong>Your current browser</strong><small>{identity?.fingerprint || 'Fingerprint initializing…'}</small></div></div>
          {devices === null && <div className="empty-inline" role="status">Loading verification codes…</div>}
          {devices?.flatMap((entry) => (entry.devices || []).map((device) => ({ ...device, userId: entry.userId }))).filter((d) => !(d.userId === myId && d.deviceId === identity?.deviceId)).map((device) => <div className="device-row" key={`${device.userId}:${device.deviceId}`}><span><KeyRound aria-hidden="true" /></span><div><strong>{participantName(active, device.userId)} · registered browser</strong><small>{device.fingerprint}</small></div></div>)}
        </div>
        <div className="technical-boundary"><strong>Technical boundary of this build</strong><p>It uses AES-256-GCM with RSA-OAEP key wrapping. It does not implement Signal Protocol's Double Ratchet, sealed sender or forward secrecy, and it cannot protect against a malicious server replacing public keys.</p></div>
        {error && <div className="error-banner" role="alert">⚠ {error}</div>}
      </div>}
      <div className="modal-actions"><button className="primary-button" onClick={onClose}>Done</button></div>
    </div>
  </div>;
}

function ConversationInfo({ active, myId, presence, onClose, onSearch, onEncryption, onClear, onBlock, onLeave }) {
  const isGroup = active.type === 'group';
  const other = isGroup ? null : peerFor(active, myId);
  const members = (active.participantIds || []).filter((person) => !person.pending);
  return <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="conversation-info-title">
    <div className="modal-card contact-info-modal">
      <div className="contact-info-hero">
        {isGroup ? <GroupAvatar name={active.name} size="xl" /> : <Avatar user={other} size="xl" />}
        <h2 id="conversation-info-title">{isGroup ? active.name : other?.name || 'Contact'}</h2>
        <p>{isGroup ? `${active.activeMemberCount || members.length} members` : `@${other?.username || 'unknown'} · ${presenceLabel(presence)}`}</p>
      </div>
      <div className="contact-quick-actions" aria-label="Conversation shortcuts">
        <button type="button" onClick={onSearch}><span aria-hidden="true">⌕</span><strong>Search</strong></button>
        <button type="button" onClick={onEncryption}><span aria-hidden="true"><LockKeyhole /></span><strong>Encryption</strong></button>
        <button type="button" onClick={onClear}><span aria-hidden="true"><Trash2 /></span><strong>Clear chat</strong></button>
      </div>
      <section className="contact-info-section"><h3>Privacy and safety</h3><div className="info-list-row"><span><LockKeyhole aria-hidden="true" /></span><div><strong>End-to-end encrypted</strong><small>Message content is protected between registered browsers.</small></div></div><div className="info-list-row"><span><Timer aria-hidden="true" /></span><div><strong>Disappearing messages</strong><small>{MODES.find(([value]) => value === active.disappearingMode)?.[1] || 'Off'}</small></div></div></section>
      {isGroup && <section className="contact-info-section"><h3>{members.length} participants</h3><div className="participant-list">{members.map((person) => <div className="participant-row" key={idOf(person)}><Avatar user={person} size="sm" /><div><strong>{idOf(person) === myId ? `${person.name} (You)` : person.name}</strong><small>@{person.username}</small></div>{(active.adminIds || []).includes(idOf(person)) && <span className="status-pill">Admin</span>}</div>)}</div></section>}
      <div className="contact-danger-actions">{!isGroup && !active.blockedByMe && <button className="danger-text link-button" type="button" onClick={onBlock}>Block contact</button>}{isGroup && <button className="danger-text link-button" type="button" onClick={onLeave}>Leave group</button>}</div>
      <div className="modal-actions"><button className="primary-button" type="button" onClick={onClose}>Done</button></div>
    </div>
  </div>;
}

function EmptyChat({ onStart }) {
  return <div className="chat-empty">
    <img className="empty-chat-logo" src="/securechat-logo-full.jpg" alt="SecureChat" loading="lazy" decoding="async" />
    <h2>Private by design, simple by interaction.</h2>
    <p>Select a conversation or type the start of a username. Suggestions stay limited and respect discoverability settings.</p>
    <div className="empty-chat-actions"><button className="primary-button" type="button" onClick={onStart}><MessageCirclePlus aria-hidden="true" />Start secure chat</button><Link className="secondary-button" to="/privacy"><ShieldCheck aria-hidden="true" />Review privacy</Link></div>
    <div className="privacy-feature-row"><span><LockKeyhole aria-hidden="true" /> Browser E2EE</span><span><Search aria-hidden="true" /> Limited discovery</span><span><ShieldCheck aria-hidden="true" /> Consent requests</span></div>
  </div>;
}

function ChatSkeleton({ messages = false }) {
  return <div className={messages ? 'message-skeleton' : 'chat-list-skeleton'} aria-hidden="true">{[1,2,3,4].map((item) => <div className={`skeleton-chat-row ${messages && item % 2 === 0 ? 'mine' : ''}`} key={item}><span className="skeleton-block skeleton-avatar" /><span><i className="skeleton-block" /><i className="skeleton-block" /></span></div>)}</div>;
}

export default function ChatPage() {
  const { user } = useAuth();
  const myId = idOf(user);
  const socket = useSocket();
  const { settings } = usePrivacy();
  const {
    status: cryptoStatus, error: cryptoError, identity,
    encryptForConversation, encryptForUser, encryptAttachmentForConversation,
    decrypt, openAttachment, sanitizeImageForSharing,
  } = useE2EE();

  const [conversations, setConversations] = useState([]);
  const [requests, setRequests] = useState([]);
  const [sentRequests, setSentRequests] = useState([]);
  const [groupInvites, setGroupInvites] = useState([]);
  const [requestPreviews, setRequestPreviews] = useState({});
  const [conversationPreviews, setConversationPreviews] = useState({});
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [events, setEvents] = useState([]);
  const [draft, setDraft] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchState, setSearchState] = useState('idle');
  const searchRequestRef = useRef(0);
  const [listsLoading, setListsLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [requestTarget, setRequestTarget] = useState(null);
  const [filter, setFilter] = useState('all');
  const [typingUsers, setTypingUsers] = useState([]);
  const [presence, setPresence] = useState('checking');
  const [connectionState, setConnectionState] = useState('connecting');
  const [chatMode, setChatMode] = useState('off');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [chatSearch, setChatSearch] = useState('');
  const [showChatSearch, setShowChatSearch] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [reactingToId, setReactingToId] = useState(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [showGroupComposer, setShowGroupComposer] = useState(false);
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  const [showEncryptionInfo, setShowEncryptionInfo] = useState(false);
  const [showConversationInfo, setShowConversationInfo] = useState(false);
  const [stagedFile, setStagedFile] = useState(null);
  const [stagedFileInfo, setStagedFileInfo] = useState(null);
  const [sendingAttachment, setSendingAttachment] = useState(false);
  const [showMicExplainer, setShowMicExplainer] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [voicePreviewUrl, setVoicePreviewUrl] = useState('');
  const [mediaUrls, setMediaUrls] = useState({});
  const [now, setNow] = useState(() => Date.now());
  const [unread, setUnread] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`securechat_unread_${myId}`) || '{}'); } catch { return {}; }
  });

  const bottomRef = useRef(null);
  const listRef = useRef(null);
  const fileRef = useRef(null);
  const searchRef = useRef(null);
  const typingTimer = useRef(null);
  const typingSent = useRef(false);
  const typingClearTimers = useRef(new Map());
  const recorderRef = useRef(null);
  const recorderStreamRef = useRef(null);
  const recorderChunksRef = useRef([]);
  const recordTickerRef = useRef(null);
  const recordStartedAtRef = useRef(0);
  const voicePreviewUrlRef = useRef('');
  const mediaUrlsRef = useRef({});
  const activeIdRef = useRef(activeId);
  const conversationsRef = useRef(conversations);
  const settingsRef = useRef(settings);
  const cryptoStatusRef = useRef(cryptoStatus);

  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { cryptoStatusRef.current = cryptoStatus; }, [cryptoStatus]);
  useEffect(() => { voicePreviewUrlRef.current = voicePreviewUrl; }, [voicePreviewUrl]);
  useEffect(() => { mediaUrlsRef.current = mediaUrls; }, [mediaUrls]);
  useEffect(() => { if (myId) localStorage.setItem(`securechat_unread_${myId}`, JSON.stringify(unread)); }, [unread, myId]);

  const flash = useCallback((text) => {
    setNotice(text);
    window.clearTimeout(window.__securechatNoticeTimer);
    window.__securechatNoticeTimer = window.setTimeout(() => setNotice(''), 3400);
  }, []);

  const hydrateOne = useCallback(async (message) => {
    if (!message) return message;
    if (Number(message.e2eeVersion) !== 1) return { ...message, _content: { kind: message.contentKind || 'text', text: message.text || '', legacy: true } };
    if (cryptoStatusRef.current !== 'ready') return { ...message, _decryptPending: true };
    try { return { ...message, _content: await decrypt(message), _decryptError: null, _decryptPending: false }; }
    catch (e) { return { ...message, _content: null, _decryptPending: false, _decryptError: e.message || 'Unable to decrypt on this browser.' }; }
  }, [decrypt]);

  const hydrateMany = useCallback(async (items) => Promise.all((items || []).map(hydrateOne)), [hydrateOne]);

  const loadLists = useCallback(async () => {
    const [{ data: cs }, { data: incoming }, { data: outgoing }, { data: invites }] = await Promise.all([
      api.get('/conversations'), api.get('/conversations/requests'), api.get('/conversations/requests/sent'), api.get('/groups/invites'),
    ]);
    setConversations(cs); setRequests(incoming); setSentRequests(outgoing); setGroupInvites(invites);
    if (activeIdRef.current && !cs.some((c) => idOf(c) === idOf(activeIdRef.current))) setActiveId(null);
  }, []);

  const reloadActive = useCallback(async (conversationId = activeIdRef.current) => {
    if (!conversationId) return;
    const [{ data: rawMessages }, { data: evs }] = await Promise.all([
      api.get(`/conversations/${conversationId}/messages`), api.get(`/conversations/${conversationId}/events`),
    ]);
    setMessages(await hydrateMany(rawMessages)); setEvents(evs);
  }, [hydrateMany]);

  useEffect(() => { loadLists().catch(() => setError('Could not load your conversations. Check that the backend is running.')).finally(() => setListsLoading(false)); }, [loadLists]);

  useEffect(() => {
    if (cryptoStatus !== 'ready') return;
    let cancelled = false;
    Promise.all(conversations.map(async (c) => [idOf(c), c.lastMessage ? await hydrateOne(c.lastMessage) : null])).then((entries) => {
      if (!cancelled) setConversationPreviews(Object.fromEntries(entries.map(([key, msg]) => [key, contentPreview(msg?._content)])));
    });
    Promise.all(requests.map(async (r) => [idOf(r), r.intro ? await hydrateOne(r.intro) : null])).then((entries) => {
      if (!cancelled) setRequestPreviews(Object.fromEntries(entries.map(([key, msg]) => [key, contentPreview(msg?._content)])));
    });
    return () => { cancelled = true; };
  }, [cryptoStatus, conversations, requests, hydrateOne]);

  useEffect(() => { if (cryptoStatus === 'ready' && activeIdRef.current) reloadActive().catch(() => {}); }, [cryptoStatus, reloadActive]);

  const active = conversations.find((c) => idOf(c) === idOf(activeId));
  const other = active?.type === 'direct' ? peerFor(active, myId) : null;

  useEffect(() => {
    if (!activeId) { setMessages([]); setEvents([]); setTypingUsers([]); setPresence('checking'); setChatMenuOpen(false); setShowChatSearch(false); return undefined; }
    setError(''); setMessages([]); setEvents([]); setChatSearch(''); setEditingId(null); setStagedFile(null); setStagedFileInfo(null);
    if (voicePreviewUrlRef.current) { URL.revokeObjectURL(voicePreviewUrlRef.current); voicePreviewUrlRef.current = ''; setVoicePreviewUrl(''); }
    setChatMode(conversationsRef.current.find((c) => idOf(c) === idOf(activeId))?.disappearingMode || 'off');
    if (cryptoStatus === 'ready') { setThreadLoading(true); reloadActive(activeId).catch(() => setError('Could not load this conversation.')).finally(() => setThreadLoading(false)); }
    socket?.emit('conversation:join', activeId, (result) => { if (!result?.ok) setError('This conversation is not available on the live connection.'); });
    socket?.emit('presence:query', { conversationId: activeId });
    setUnread((prev) => ({ ...prev, [activeId]: 0 }));
    return () => {
      if (typingSent.current && socket) socket.emit('typing:stop', { conversationId: activeId });
      typingSent.current = false;
    };
  }, [activeId, reloadActive, socket, cryptoStatus]);

  const markActiveRead = useCallback(() => {
    const conversationId = activeIdRef.current;
    if (!conversationId || !socket || !settingsRef.current?.readReceipts) return;
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
    socket.emit('conversation:markRead', { conversationId });
    setUnread((prev) => ({ ...prev, [conversationId]: 0 }));
  }, [socket]);

  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === 'visible') markActiveRead(); };
    window.addEventListener('focus', markActiveRead);
    document.addEventListener('visibilitychange', onVisibility);
    return () => { window.removeEventListener('focus', markActiveRead); document.removeEventListener('visibilitychange', onVisibility); };
  }, [markActiveRead]);

  const showBrowserNotification = useCallback(async (message) => {
    const current = settingsRef.current;
    if (!current?.notificationsEnabled) return;
    if (!isNativePlatform && !('Notification' in window)) return;
    const conversation = conversationsRef.current.find((c) => idOf(c) === idOf(message.conversationId));
    const isOpenConversation = conversation && idOf(conversation) === idOf(activeIdRef.current);
    if (isOpenConversation && (isNativePlatform || document.visibilityState === 'visible')) return;
    const sender = conversation?.participantIds?.find((p) => idOf(p) === idOf(message.senderId));
    const senderName = sender?.name || sender?.username || (conversation?.type === 'group' ? 'A group member' : 'Someone');
    const title = conversation?.type === 'group' ? conversation.name || 'SecureChat group' : 'SecureChat';
    let body = 'New encrypted message received.';
    if (current.notificationPrivacyLevel === 'sender_only') body = `${senderName} sent a secure message.`;
    if (current.notificationPrivacyLevel === 'detailed') {
      const hydrated = await hydrateOne(message);
      body = `${senderName}: ${contentPreview(hydrated?._content).slice(0, 80)}`;
    }
    await showMessageNotification({ title, body, conversationId: idOf(message.conversationId) });
  }, [hydrateOne]);

  useEffect(() => onNotificationTap((conversationId) => {
    setActiveId(conversationId);
    window.focus();
  }), []);

  useEffect(() => {
    if (!isNativePlatform) return undefined;
    initializePushNotifications().catch(() => {});
    const openFromPush = (event) => { const { conversationId } = event?.detail || {}; if (conversationId) setActiveId(conversationId); };
    window.addEventListener('securechat:open-conversation', openFromPush);
    window.__securechatActiveConversationRef = { getCurrent: () => activeIdRef.current };
    return () => {
      window.removeEventListener('securechat:open-conversation', openFromPush);
      delete window.__securechatActiveConversationRef;
    };
  }, []);

  useEffect(() => {
    if (!socket) return undefined;
    const onConnect = () => { setConnectionState('connected'); if (activeIdRef.current) socket.emit('presence:query', { conversationId: activeIdRef.current }); };
    const onDisconnect = () => { setConnectionState('offline'); setTypingUsers([]); };
    const onConnectError = () => setConnectionState('offline');
    const onNew = async (rawMessage) => {
      const convId = idOf(rawMessage.conversationId); const mine = idOf(rawMessage.senderId) === myId;
      if (!mine) showBrowserNotification(rawMessage).catch(() => {});
      const hydrated = await hydrateOne(rawMessage);
      if (convId === idOf(activeIdRef.current)) {
        setMessages((prev) => prev.some((m) => idOf(m) === idOf(hydrated)) ? prev.map((m) => idOf(m) === idOf(hydrated) ? { ...m, ...hydrated } : m) : [...prev, hydrated]);
        if (!mine) window.setTimeout(markActiveRead, 40);
      } else if (!mine) setUnread((prev) => ({ ...prev, [convId]: (prev[convId] || 0) + 1 }));
      loadLists().catch(() => {});
    };
    const onReceipt = ({ conversationId, messageId, deliveredAt, readAt, deliveryReceipts }) => {
      if (idOf(conversationId) !== idOf(activeIdRef.current)) return;
      setMessages((prev) => prev.map((m) => idOf(m) === idOf(messageId) ? { ...m, deliveredAt, readAt, deliveryReceipts: deliveryReceipts || m.deliveryReceipts } : m));
    };
    const onTypingStart = ({ userId, conversationId }) => {
      if (idOf(conversationId) !== idOf(activeIdRef.current) || idOf(userId) === myId) return;
      const uid = idOf(userId);
      setTypingUsers((prev) => prev.includes(uid) ? prev : [...prev, uid]);
      clearTimeout(typingClearTimers.current.get(uid));
      typingClearTimers.current.set(uid, setTimeout(() => setTypingUsers((prev) => prev.filter((x) => x !== uid)), 4500));
    };
    const onTypingStop = ({ userId, conversationId }) => {
      if (idOf(conversationId) !== idOf(activeIdRef.current)) return;
      const uid = idOf(userId); clearTimeout(typingClearTimers.current.get(uid)); typingClearTimers.current.delete(uid);
      setTypingUsers((prev) => prev.filter((x) => x !== uid));
    };
    const onPresence = ({ userId, state, conversationId, memberCount }) => {
      const current = conversationsRef.current.find((c) => idOf(c) === idOf(activeIdRef.current));
      if (current?.type === 'group' && idOf(conversationId) === idOf(activeIdRef.current)) { setPresence(`group:${memberCount || current.activeMemberCount || 1}`); return; }
      const peer = current?.participantIds?.find((p) => idOf(p) !== myId);
      if (idOf(userId) === idOf(peer) && (!conversationId || idOf(conversationId) === idOf(activeIdRef.current))) setPresence(state || 'checking');
    };
    const onPrivacyChanged = ({ conversationId, field, message }) => {
      loadLists().catch(() => {}); // immediately re-evaluate avatar/profile visibility
      if (idOf(conversationId) === idOf(activeIdRef.current)) {
        flash(message || 'A privacy preference changed for this conversation.'); reloadActive().catch(() => {});
        if (field === 'showTypingStatus') setTypingUsers([]);
        if (field === 'onlineStatus') socket.emit('presence:query', { conversationId: activeIdRef.current });
      }
    };
    const onConversationEvent = ({ conversationId, disappearingMode, event }) => {
      loadLists().catch(() => {});
      if (idOf(conversationId) === idOf(activeIdRef.current)) {
        if (disappearingMode) setChatMode(disappearingMode);
        if (event) setEvents((prev) => prev.some((e) => idOf(e) === idOf(event)) ? prev : [...prev, event]);
      }
    };
    const onListChange = () => loadLists().catch(() => {});
    const onUpdated = async (rawMessage) => {
      const hydrated = await hydrateOne(rawMessage);
      if (idOf(hydrated.conversationId) === idOf(activeIdRef.current)) setMessages((prev) => prev.map((m) => idOf(m) === idOf(hydrated) ? hydrated : m));
      loadLists().catch(() => {});
    };
    const onDeleted = ({ messageId, conversationId }) => { if (idOf(conversationId) === idOf(activeIdRef.current)) setMessages((prev) => prev.filter((m) => idOf(m) !== idOf(messageId))); loadLists().catch(() => {}); };
    const onReactions = ({ messageId, reactions }) => { setMessages((prev) => prev.map((m) => idOf(m) === idOf(messageId) ? { ...m, reactions } : m)); };
    const onAccountRemoved = ({ userId }) => { const current = conversationsRef.current.find((c) => idOf(c) === idOf(activeIdRef.current)); if (current?.type === 'direct' && idOf(peerFor(current, myId)) === idOf(userId)) setActiveId(null); loadLists().catch(() => {}); };
    const onCleared = ({ conversationId }) => {
      if (idOf(conversationId) === idOf(activeIdRef.current)) { setMessages([]); setEvents([]); setChatSearch(''); setShowChatSearch(false); }
      setConversationPreviews((prev) => ({ ...prev, [idOf(conversationId)]: '' }));
      setUnread((prev) => ({ ...prev, [idOf(conversationId)]: 0 }));
      loadLists().catch(() => {});
    };

    setConnectionState(socket.connected ? 'connected' : 'connecting');
    socket.on('connect', onConnect); socket.on('disconnect', onDisconnect); socket.on('connect_error', onConnectError);
    socket.on('message:new', onNew); socket.on('messages:receipt-update', onReceipt);
    socket.on('typing:start', onTypingStart); socket.on('typing:stop', onTypingStop);
    socket.on('presence:state', onPresence); socket.on('presence:update', onPresence);
    socket.on('privacy:changed', onPrivacyChanged); socket.on('conversation:settings', onConversationEvent); socket.on('conversation:accepted', onConversationEvent);
    socket.on('conversation:request', onListChange); socket.on('conversation:request-removed', onListChange); socket.on('group:invite', onListChange); socket.on('group:membership', onConversationEvent);
    socket.on('message:updated', onUpdated); socket.on('message:deleted', onDeleted); socket.on('message:reactions', onReactions); socket.on('profile:changed', onListChange); socket.on('block:changed', onListChange); socket.on('account:removed', onAccountRemoved);
    socket.on('conversation:cleared', onCleared);
    return () => {
      socket.off('connect', onConnect); socket.off('disconnect', onDisconnect); socket.off('connect_error', onConnectError);
      socket.off('message:new', onNew); socket.off('messages:receipt-update', onReceipt);
      socket.off('typing:start', onTypingStart); socket.off('typing:stop', onTypingStop); socket.off('presence:state', onPresence); socket.off('presence:update', onPresence);
      socket.off('privacy:changed', onPrivacyChanged); socket.off('conversation:settings', onConversationEvent); socket.off('conversation:accepted', onConversationEvent);
      socket.off('conversation:request', onListChange); socket.off('conversation:request-removed', onListChange); socket.off('group:invite', onListChange); socket.off('group:membership', onConversationEvent);
      socket.off('message:updated', onUpdated); socket.off('message:deleted', onDeleted); socket.off('message:reactions', onReactions); socket.off('profile:changed', onListChange); socket.off('block:changed', onListChange); socket.off('account:removed', onAccountRemoved);
      socket.off('conversation:cleared', onCleared);
    };
  }, [socket, myId, loadLists, reloadActive, flash, markActiveRead, showBrowserNotification, hydrateOne]);

  useEffect(() => {
    if (!messages.some((m) => m.expiresAt)) return undefined;
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    const expiries = messages.map((m) => m.expiresAt ? new Date(m.expiresAt).getTime() : Infinity).filter((v) => v > Date.now());
    const soonest = Math.min(...expiries);
    const timer = Number.isFinite(soonest) ? setTimeout(() => { setNow(Date.now()); setMessages((prev) => prev.filter((m) => !m.expiresAt || new Date(m.expiresAt).getTime() > Date.now())); }, Math.max(50, soonest - Date.now() + 50)) : null;
    return () => { clearInterval(interval); if (timer) clearTimeout(timer); };
  }, [messages]);

  // Intentionally excludes accessibility settings from dependencies. Toggling
  // contrast or reduced motion must never hijack the user's scroll position.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: document.documentElement.dataset.reducedMotion === 'true' ? 'auto' : 'smooth' });
  }, [messages.length, events.length, typingUsers.length, activeId]);

  useEffect(() => {
    const keydown = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchRef.current?.focus(); } };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, []);

  useEffect(() => () => {
    clearInterval(recordTickerRef.current);
    try { if (recorderRef.current?.state === 'recording') recorderRef.current.stop(); } catch {}
    recorderStreamRef.current?.getTracks?.().forEach((track) => track.stop());
    if (voicePreviewUrlRef.current) URL.revokeObjectURL(voicePreviewUrlRef.current);
    Object.values(mediaUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
  }, []); // cleanup once on unmount using refs, avoiding stale state closures

  const runUserSearch = useCallback(async (rawQuery) => {
    const q = rawQuery.trim().replace(/^@/, '').toLowerCase();
    const requestNumber = ++searchRequestRef.current;
    if (!q) { setSearchResults([]); setSearchState('idle'); return; }
    if (!USERNAME_PREFIX.test(q)) { setSearchResults([]); setSearchState('invalid'); return; }
    setSearchState('searching');
    try {
      const { data } = await api.get('/users/search', { params: { username: q } });
      if (requestNumber !== searchRequestRef.current) return;
      setSearchResults(data); setSearchState(data.length ? 'found' : 'empty');
    } catch {
      if (requestNumber === searchRequestRef.current) { setSearchResults([]); setSearchState('empty'); }
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => runUserSearch(searchQuery), 280);
    return () => clearTimeout(timer);
  }, [searchQuery, runUserSearch]);

  const submitUserSearch = (event) => { event.preventDefault(); runUserSearch(searchQuery); };

  const chooseSearchResult = (target) => {
    if (target.connected && target.conversationId) { setActiveId(idOf(target.conversationId)); setSearchQuery(''); setSearchResults([]); setSearchState('idle'); return; }
    if (target.pending) { setFilter('requests'); setError('A chat request already exists between these accounts.'); return; }
    setRequestTarget(target);
  };
  const requestSent = async () => { setRequestTarget(null); setSearchQuery(''); setSearchResults([]); setSearchState('idle'); await loadLists(); flash('Chat request sent.'); };
  const accept = async (conversationId) => { try { const { data } = await api.post(`/conversations/${conversationId}/accept`); await loadLists(); setActiveId(idOf(data)); flash('Chat accepted.'); } catch (e) { setError(e.response?.data?.error || 'Could not accept this request.'); } };
  const decline = async (conversationId) => { try { await api.post(`/conversations/${conversationId}/decline`); await loadLists(); flash('Request declined and its encrypted introduction was removed.'); } catch (e) { setError(e.response?.data?.error || 'Could not decline the request.'); } };
  const cancelRequest = async (conversationId) => { try { await api.delete(`/conversations/${conversationId}/request`); await loadLists(); flash('Sent request cancelled and removed.'); } catch (e) { setError(e.response?.data?.error || 'Could not cancel the request.'); } };
  const acceptGroup = async (conversationId) => { try { const { data } = await api.post(`/groups/${conversationId}/accept`); await loadLists(); setActiveId(idOf(data)); flash('Group invitation accepted. You can now receive its encrypted content.'); } catch (e) { setError(e.response?.data?.error || 'Could not accept the group invitation.'); } };
  const declineGroup = async (conversationId) => { try { await api.post(`/groups/${conversationId}/decline`); await loadLists(); flash('Group invitation declined.'); } catch (e) { setError(e.response?.data?.error || 'Could not decline the group invitation.'); } };

  const stopTyping = useCallback(() => {
    clearTimeout(typingTimer.current);
    if (typingSent.current && socket && activeIdRef.current) socket.emit('typing:stop', { conversationId: activeIdRef.current });
    typingSent.current = false;
  }, [socket]);
  const handleTyping = (value) => {
    setDraft(value);
    if (!socket || !activeId || !settings?.showTypingStatus || !value.trim()) { stopTyping(); return; }
    if (!typingSent.current) { socket.emit('typing:start', { conversationId: activeId }); typingSent.current = true; }
    clearTimeout(typingTimer.current); typingTimer.current = setTimeout(stopTyping, 1300);
  };

  const emitMessage = useCallback((conversationId, envelope) => new Promise((resolve, reject) => {
    if (!socket?.connected) return reject(new Error('Live connection is offline. Reconnect before sending.'));
    socket.emit('message:send', { conversationId, ...envelope }, (result) => result?.ok ? resolve(result.message) : reject(new Error(result?.error || 'Message could not be sent.')));
  }), [socket]);

  const send = async (event) => {
    event.preventDefault(); setError('');
    const text = draft.trim(); if (!text || !activeId) return;
    if (cryptoStatus !== 'ready') return setError(cryptoError || 'Encrypted messaging is still initializing.');
    try {
      const envelope = await encryptForConversation(activeId, { kind: 'text', text });
      setDraft(''); stopTyping();
      const raw = await emitMessage(activeId, envelope);
      if (raw) { const hydrated = await hydrateOne(raw); setMessages((prev) => prev.some((m) => idOf(m) === idOf(hydrated)) ? prev : [...prev, hydrated]); }
    } catch (e) { setError(e.message || 'Message could not be sent.'); }
  };

  const chooseAttachment = async (event) => {
    const original = event.target.files?.[0]; event.target.value = '';
    if (!original) return;
    setError('');
    if (original.size > MAX_ATTACHMENT_BYTES) return setError('Choose a file smaller than 24 MB so encrypted upload remains within the server limit.');
    try {
      const { file, metadataStripped } = await sanitizeImageForSharing(original);
      setStagedFile(file); setStagedFileInfo({ originalName: original.name, name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, metadataStripped, kind: 'attachment' });
    } catch { setStagedFile(original); setStagedFileInfo({ originalName: original.name, name: original.name, mimeType: original.type || 'application/octet-stream', size: original.size, metadataStripped: false, kind: 'attachment' }); }
  };

  const sendStaged = async () => {
    if (!stagedFile || !stagedFileInfo || !activeId) return;
    setSendingAttachment(true); setError('');
    try {
      const payload = { kind: stagedFileInfo.kind, attachment: { name: stagedFileInfo.name, mimeType: stagedFileInfo.mimeType, size: stagedFileInfo.size, durationSeconds: stagedFileInfo.durationSeconds || null, metadataStripped: !!stagedFileInfo.metadataStripped } };
      const envelope = await encryptAttachmentForConversation({ conversationId: activeId, payload, file: stagedFile });
      const raw = await emitMessage(activeId, envelope);
      if (raw) { const hydrated = await hydrateOne(raw); setMessages((prev) => prev.some((m) => idOf(m) === idOf(hydrated)) ? prev : [...prev, hydrated]); }
      if (voicePreviewUrl) { URL.revokeObjectURL(voicePreviewUrl); setVoicePreviewUrl(''); }
      setStagedFile(null); setStagedFileInfo(null); flash(stagedFileInfo.kind === 'voice' ? 'Encrypted voice note sent.' : 'Encrypted attachment sent.');
    } catch (e) { setError(e.response?.data?.error || e.message || 'Could not send this attachment.'); }
    finally { setSendingAttachment(false); }
  };

  const beginRecording = async () => {
    setShowMicExplainer(false); setError('');
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return setError('Voice recording is not supported by this browser.');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      recorderStreamRef.current = stream;
      const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((type) => MediaRecorder.isTypeSupported?.(type));
      const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
      recorderChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data?.size) recorderChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        clearInterval(recordTickerRef.current);
        const mimeType = recorder.mimeType || preferred || 'audio/webm';
        const blob = new Blob(recorderChunksRef.current, { type: mimeType });
        const ext = mimeType.includes('ogg') ? 'ogg' : 'webm';
        const file = new File([blob], `voice-note.${ext}`, { type: mimeType, lastModified: Date.now() });
        const durationSeconds = Math.max(1, Math.round((Date.now() - recordStartedAtRef.current) / 1000));
        if (voicePreviewUrlRef.current) URL.revokeObjectURL(voicePreviewUrlRef.current);
        const url = URL.createObjectURL(blob); voicePreviewUrlRef.current = url; setVoicePreviewUrl(url);
        setStagedFile(file); setStagedFileInfo({ name: 'Voice note', mimeType, size: file.size, metadataStripped: false, kind: 'voice', durationSeconds });
        stream.getTracks().forEach((track) => track.stop()); recorderStreamRef.current = null;
      };
      recorderRef.current = recorder; setRecordSeconds(0); setRecording(true); recordStartedAtRef.current = Date.now(); recorder.start(250);
      recordTickerRef.current = setInterval(() => setRecordSeconds(Math.floor((Date.now() - recordStartedAtRef.current) / 1000)), 500);
    } catch (e) { setError(e.name === 'NotAllowedError' ? 'Microphone permission was not granted. Nothing was recorded.' : 'Could not start the microphone.'); }
  };

  const requestRecording = () => {
    if (recording) return;
    if (sessionStorage.getItem('securechat_mic_explained') === '1') beginRecording();
    else setShowMicExplainer(true);
  };
  const continueRecording = () => { sessionStorage.setItem('securechat_mic_explained', '1'); beginRecording(); };
  const stopRecording = () => {
    if (!recording) return;
    clearInterval(recordTickerRef.current); setRecording(false);
    try { recorderRef.current?.stop(); } catch {}
  };
  const discardStaged = () => {
    if (voicePreviewUrlRef.current) { URL.revokeObjectURL(voicePreviewUrlRef.current); voicePreviewUrlRef.current = ''; setVoicePreviewUrl(''); }
    setStagedFile(null); setStagedFileInfo(null);
  };

  const openEncryptedMedia = async (message, playOnly = false) => {
    const key = idOf(message);
    try {
      let url = mediaUrls[key];
      if (!url) { url = await openAttachment(message, message._content); setMediaUrls((prev) => ({ ...prev, [key]: url })); }
      if (playOnly) return;
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = message._content?.attachment?.name || 'securechat-file'; document.body.appendChild(anchor); anchor.click(); anchor.remove();
    } catch (e) { setError(e.response?.data?.error || e.message || 'Could not decrypt this attachment.'); }
  };

  const updateMode = async (mode) => {
    try { const { data } = await api.patch(`/conversations/${activeId}/disappearing`, { mode }); setChatMode(data.disappearingMode); flash(`Disappearing messages: ${MODES.find(([v]) => v === mode)?.[1] || mode}. Applies to new messages.`); }
    catch (e) { setError(e.response?.data?.error || 'Could not change message retention.'); }
  };

  const toggleReaction = async (message, emoji) => {
    if (!message || !emoji) return;
    try {
      const { data } = await api.post(`/messages/${idOf(message)}/reactions`, { emoji });
      setMessages((prev) => prev.map((m) => idOf(m) === idOf(message) ? { ...m, reactions: data.reactions } : m));
    } catch (e) { setError(e.response?.data?.error || 'Could not send that reaction.'); }
  };
  const insertEmoji = (emoji) => { setDraft((prev) => prev + emoji); setShowEmojiPicker(false); };
  const saveEdit = async (messageId) => {
    const text = editText.trim(); if (!text || !activeId) return;
    try {
      const envelope = await encryptForConversation(activeId, { kind: 'text', text });
      const { data } = await api.patch(`/messages/${messageId}`, envelope);
      const hydrated = await hydrateOne(data); setMessages((prev) => prev.map((m) => idOf(m) === idOf(messageId) ? hydrated : m)); setEditingId(null); setEditText('');
    } catch (e) { setError(e.response?.data?.error || e.message || 'Could not edit the message.'); }
  };
  const deleteMessage = async () => {
    const messageId = confirmDeleteId; setConfirmDeleteId(null);
    try { await api.delete(`/messages/${messageId}`); setMessages((prev) => prev.filter((m) => idOf(m) !== idOf(messageId))); flash('Message permanently deleted from SecureChat storage.'); }
    catch (e) { setError(e.response?.data?.error || 'Could not delete the message.'); }
  };
  const clearChat = async () => {
    setConfirmClear(false);
    try {
      await api.delete(`/conversations/${activeId}/history`);
      Object.values(mediaUrls).forEach((url) => URL.revokeObjectURL(url));
      setMessages([]); setEvents([]); setMediaUrls({}); setChatSearch(''); setShowChatSearch(false);
      setConversationPreviews((prev) => ({ ...prev, [activeId]: '' }));
      setUnread((prev) => ({ ...prev, [activeId]: 0 }));
      await loadLists();
      flash('Chat cleared for you. Other participants were not affected.');
    } catch (e) { setError(e.response?.data?.error || 'Could not clear this chat. Nothing was changed.'); }
  };
  const blockPeer = async () => {
    if (!other) return; setConfirmBlock(false);
    try { await api.post(`/users/${idOf(other)}/block`); await loadLists(); flash('Contact blocked. New messages, presence and typing stop.'); }
    catch (e) { setError(e.response?.data?.error || 'Could not block this contact.'); }
  };
  const unblockPeer = async () => {
    if (!other) return;
    try { await api.delete(`/users/${idOf(other)}/block`); await loadLists(); flash('Contact unblocked.'); }
    catch (e) { setError(e.response?.data?.error || 'Could not unblock this contact.'); }
  };
  const leaveGroup = async () => {
    setConfirmLeave(false);
    try { await api.post(`/groups/${activeId}/leave`); setActiveId(null); await loadLists(); flash('You left the group. New group content will no longer be delivered to you.'); }
    catch (e) { setError(e.response?.data?.error || 'Could not leave the group.'); }
  };
  const groupCreated = async (data) => { setShowGroupComposer(false); await loadLists(); setActiveId(idOf(data)); flash('Group created. Invited members must accept before receiving content.'); };

  const visibleMessages = messages
    .filter((m) => !m.expiresAt || new Date(m.expiresAt).getTime() > now)
    .filter((m) => !chatSearch.trim() || contentPreview(m._content).toLowerCase().includes(chatSearch.trim().toLowerCase()));
  const timeline = useMemo(() => [...events.map((e) => ({ ...e, __kind: 'event', __time: e.createdAt })), ...visibleMessages.map((m) => ({ ...m, __kind: 'message', __time: m.sentAt }))].sort((a, b) => new Date(a.__time) - new Date(b.__time)), [events, visibleMessages]);

  const filteredConversations = conversations.filter((c) => {
    if (filter === 'groups') return c.type === 'group';
    if (filter === 'unread') return (unread[idOf(c)] || 0) > 0;
    if (filter === 'requests') return false;
    return true;
  });
  const requestCount = requests.length + sentRequests.length + groupInvites.length;
  const unreadCount = Object.values(unread).reduce((sum, value) => sum + Number(value || 0), 0);
  const presenceText = active?.type === 'group'
    ? `${active.activeMemberCount || active.participantIds?.filter((p) => !p.pending).length || 1} members`
    : typingUsers.length ? 'Typing…' : presence === 'online' ? 'Online' : presence === 'offline' ? 'Offline' : presence === 'hidden' ? 'Presence hidden' : presence === 'unavailable' ? 'Presence unavailable' : 'Checking presence…';
  const typingText = typingUsers.length === 1 ? `${participantName(active, typingUsers[0])} is typing…` : typingUsers.length > 1 ? `${typingUsers.length} people are typing…` : '';
  const canSend = active?.messagingAvailable && cryptoStatus === 'ready' && connectionState === 'connected';

  return <div className={`chat-page chat-v2 ${activeId ? 'has-active' : ''}`}>
    <aside className="chat-sidebar" aria-label="Conversations">
      <div className="sidebar-top">
        <div><h1>Chats</h1><span className="sidebar-subtitle">Private by design</span></div>
        <div className="sidebar-actions"><span className={`connection-dot ${connectionState}`} title={`Live connection: ${connectionState}`} /><button className="icon-button compose-group-button" type="button" onClick={() => setShowGroupComposer(true)} title="Create group" aria-label="Create a new group">＋</button></div>
      </div>

      <form className="user-search compact-search" onSubmit={submitUserSearch}>
        <label className="sr-only" htmlFor="user-search">Find a username</label>
        <div className="search-input-wrap"><span aria-hidden="true">⌕ @</span><input ref={searchRef} id="user-search" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value.replace(/^@/, '').replace(/[^a-z0-9_]/gi, '').slice(0, 30))} placeholder="Type a username" autoCapitalize="none" autoComplete="off" /><kbd>Ctrl K</kbd></div>
        <button className="sr-only" type="submit">Search usernames</button>
      </form>
      <p className="search-privacy-note">Suggestions appear after 2 characters. Results are limited, never use email, and respect each account's discoverability choice.</p>

      <div className="chat-filter-row" role="tablist" aria-label="Chat filters">
        {[['all', 'All', conversations.length], ['unread', 'Unread', unreadCount], ['requests', 'Requests', requestCount], ['groups', 'Groups', conversations.filter((c) => c.type === 'group').length]].map(([key, label, count]) => <button key={key} type="button" className={filter === key ? 'active' : ''} onClick={() => setFilter(key)} role="tab" aria-selected={filter === key}>{label}{count > 0 && key !== 'all' ? <span>{count > 99 ? '99+' : count}</span> : null}</button>)}
      </div>

      <div className="sidebar-scroll">
        {listsLoading && <ChatSkeleton />}
        {searchState === 'searching' && <div className="inline-status" role="status">Finding usernames…</div>}
        {searchState === 'invalid' && <div className="inline-status" role="status">Type at least 2 letters, numbers or underscores.</div>}
        {searchState === 'empty' && <div className="inline-status" role="status">No discoverable username starts with that text.</div>}
        {searchResults.map((target) => <button type="button" className="search-result-card" key={target.id} onClick={() => chooseSearchResult(target)}><Avatar user={target} hidden={target.avatarPlaceholder} size="sm" /><span><strong>{target.name || `@${target.username}`}</strong><small>{target.name ? `@${target.username}` : 'Limited profile · more info after they accept'}</small></span><span aria-hidden="true">›</span></button>)}

        {(filter === 'requests' || filter === 'all') && requestCount > 0 && <section className="request-section">
          {groupInvites.map((invite) => <article className="request-card group-request-card" key={`g-${invite.id}`}><div className="request-person"><GroupAvatar name={invite.name} size="sm" /><div><strong>{invite.name}</strong><small>Group invite · {invite.memberCount} invited members</small></div></div><p className="request-preview">Invited by {invite.creator?.name || `@${invite.creator?.username || 'a connection'}`}</p><p className="microcopy">You receive no group content or live activity until you accept.</p><div className="request-actions"><button className="primary-button small-button" onClick={() => acceptGroup(invite.id)}>Accept</button><button className="secondary-button small-button" onClick={() => declineGroup(invite.id)}>Decline</button></div></article>)}
          {requests.map((request) => <article className="request-card" key={request.id}><div className="request-person"><Avatar user={request.sender} hidden={request.sender?.avatarPlaceholder} size="sm" /><div><strong>{request.sender?.name || 'New person'}</strong><small>@{request.sender?.username}</small></div></div><p className="request-preview">{requestPreviews[idOf(request)] || (cryptoStatus === 'ready' ? 'Encrypted introduction' : 'Decrypting introduction…')}</p><p className="microcopy">Read receipts and online status stay hidden until you accept.</p><div className="request-actions"><button className="primary-button small-button" onClick={() => accept(request.id)}>Accept</button><button className="secondary-button small-button" onClick={() => decline(request.id)}>Decline</button></div></article>)}
          {sentRequests.map((request) => <article className="sent-request" key={request.id}><Avatar user={request.target} hidden={request.target?.avatarPlaceholder} size="xs" /><div><strong>@{request.target?.username}</strong><small>Waiting for them to accept</small></div><button className="link-button" onClick={() => cancelRequest(request.id)}>Cancel</button></article>)}
        </section>}

        {filter !== 'requests' && <div className="conversation-list">{filteredConversations.length === 0 ? <div className="empty-inline centered">{filter === 'unread' ? 'No unread chats.' : filter === 'groups' ? 'No groups yet.' : 'No accepted chats yet.'}</div> : filteredConversations.map((conversation) => {
          const peer = conversation.type === 'direct' ? peerFor(conversation, myId) : null;
          const count = unread[idOf(conversation)] || 0;
          return <button type="button" key={idOf(conversation)} className={`conversation-row ${idOf(conversation) === idOf(activeId) ? 'active' : ''}`} onClick={() => setActiveId(idOf(conversation))}>
            {conversation.type === 'group' ? <GroupAvatar name={conversation.name} size="sm" /> : <Avatar user={peer} size="sm" />}
            <span className="conversation-copy"><strong>{chatTitle(conversation, myId)}</strong><small>{conversationPreviews[idOf(conversation)] || (conversation.lastMessage ? 'Encrypted message' : conversation.type === 'group' ? `${conversation.activeMemberCount || 1} members` : `@${peer?.username || 'unknown'}`)}</small></span>
            <span className="conversation-meta"><small>{timeLabel(conversation.lastMessage?.sentAt || conversation.lastMessageAt)}</small>{count > 0 && <span className="unread-badge" aria-label={`${count} unread message${count === 1 ? '' : 's'}`}>{count > 99 ? '99+' : count}</span>}</span>
          </button>;
        })}</div>}
      </div>
    </aside>

    <main className="chat-thread">
      {!activeId || !active ? <EmptyChat onStart={() => searchRef.current?.focus()} /> : <>
        <header className="chat-header">
          <button className="back-button" type="button" onClick={() => setActiveId(null)} aria-label="Close chat and return to conversations" title="Close chat"><ArrowLeft aria-hidden="true" /></button>
          {active.type === 'group' ? <GroupAvatar name={active.name} size="sm" /> : <Avatar user={other} size="sm" />}
          <button type="button" className="chat-person chat-person-button" onClick={() => setShowConversationInfo(true)} title={active.type === 'group' ? 'View group info' : 'View contact info'}>
            <strong>{chatTitle(active, myId)}</strong><span className={`presence-text ${presence}`}>{active.type === 'direct' && presence === 'online' && !typingUsers.length && <span className="presence-dot" />} {presenceText}</span>
          </button>
          <div className="chat-header-actions">
            <button className="encryption-pill" type="button" onClick={() => setShowEncryptionInfo(true)} title="View encryption details"><LockKeyhole aria-hidden="true" /><span>End-to-end encrypted</span></button>
            <button className="icon-button" type="button" title="Search this chat locally" aria-label="Search this chat locally" onClick={() => setShowChatSearch((v) => !v)}><Search aria-hidden="true" /></button>
            <div className="overflow-menu chat-overflow">
              <button className="icon-button" type="button" aria-label="Conversation options" aria-haspopup="menu" aria-expanded={chatMenuOpen} onClick={() => setChatMenuOpen((v) => !v)}><MoreHorizontal aria-hidden="true" /></button>
              {chatMenuOpen && <div className="menu-popover chat-menu" role="menu">
                <label className="menu-setting"><span>Disappearing messages</span><select value={chatMode} onChange={(e) => { updateMode(e.target.value); setChatMenuOpen(false); }}>{MODES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
                <button type="button" role="menuitem" onClick={() => { setShowEncryptionInfo(true); setChatMenuOpen(false); }}>About encryption</button>
                <button type="button" role="menuitem" onClick={() => { setConfirmClear(true); setChatMenuOpen(false); }}>Clear chat for me</button>
                {active.type === 'direct' && (active.blockedByMe ? <button type="button" role="menuitem" onClick={() => { unblockPeer(); setChatMenuOpen(false); }}>Unblock contact</button> : <button type="button" role="menuitem" className="danger-menu-item" onClick={() => { setConfirmBlock(true); setChatMenuOpen(false); }}>Block contact</button>)}
                {active.type === 'group' && <button type="button" role="menuitem" className="danger-menu-item" onClick={() => { setConfirmLeave(true); setChatMenuOpen(false); }}>Leave group</button>}
              </div>}
            </div>
          </div>
        </header>

        {connectionState !== 'connected' && <div className="connection-banner" role="status"><strong>Live connection interrupted.</strong> Loaded messages remain readable on this device; sending is paused so message state stays unambiguous.</div>}
        {!active.messagingAvailable && <div className="warning-banner compact-banner" role="status"><strong>Messaging unavailable.</strong><p>This conversation is kept for reference, but you can't send new messages here anymore.</p></div>}
        {cryptoStatus === 'error' && <div className="error-banner compact-banner" role="alert"><strong>Encrypted messaging unavailable.</strong><p>{cryptoError}</p></div>}
        {notice && <div className="chat-notice" role="status" aria-live="polite">{notice}</div>}

        {showChatSearch && <div className="chat-tools"><label className="chat-local-search"><span>⌕</span><input value={chatSearch} onChange={(e) => setChatSearch(e.target.value)} placeholder="Search decrypted messages on this device" aria-label="Search this chat on this device" autoFocus /></label><span className="microcopy">On-device filter · query is never sent to the server</span></div>}

        <div className="message-list" ref={listRef} aria-live="polite">
          {threadLoading && <ChatSkeleton messages />}
          {timeline.length === 0 && <div className="empty-inline centered">{chatSearch ? 'No messages match this local search.' : 'No messages yet. Say hello when you are ready.'}</div>}
          {timeline.map((item, index) => {
            const previous = timeline[index - 1];
            const showDay = !previous || new Date(previous.__time).toDateString() !== new Date(item.__time).toDateString();
            if (item.__kind === 'event') return <Fragment key={`e-${idOf(item)}`}>{showDay && <div className="date-separator"><span>{dayLabel(item.__time)}</span></div>}<div className="system-event"><ShieldCheck aria-hidden="true" /><div><strong>Privacy & security update</strong><p>{item.text}</p><small>{dateTimeLabel(item.createdAt)}</small></div></div></Fragment>;
            const mine = idOf(item.senderId) === myId; const status = mine ? messageStatus(item, active.type === 'group') : null; const expiry = expiryLabel(item.expiresAt, now); const content = item._content;
            const senderName = active.type === 'group' && !mine ? participantName(active, item.senderId) : '';
            const isVoice = content?.kind === 'voice'; const isAttachment = content?.kind === 'attachment'; const mediaUrl = mediaUrls[idOf(item)];
            return <Fragment key={idOf(item)}>{showDay && <div className="date-separator"><span>{dayLabel(item.__time)}</span></div>}<article className={`message-row ${mine ? 'mine' : 'theirs'}`}>
              <div className={`message-bubble ${mine ? 'mine' : 'theirs'} ${isVoice || isAttachment ? 'media-message' : ''}`}>
                {senderName && <span className="group-sender-name">{senderName}</span>}
                {item._decryptPending && <p className="decrypt-state">Decrypting on this device…</p>}
                {item._decryptError && <div className="decrypt-error"><strong>Can't decrypt this message here</strong><small>{item._decryptError}</small></div>}
                {content?.legacy && <div className="legacy-label" title="This message existed before browser E2EE was enabled">Legacy · not E2EE</div>}
                {content?.kind === 'text' && (editingId === idOf(item) ? <div className="edit-box"><textarea value={editText} onChange={(e) => setEditText(e.target.value)} maxLength={10000} autoFocus /><div><button className="link-button" onClick={() => { setEditingId(null); setEditText(''); }}>Cancel</button><button className="link-button" onClick={() => saveEdit(idOf(item))}>Save encrypted edit</button></div></div> : <p>{content.text}</p>)}
                {isAttachment && <div className="attachment-bubble"><span className="attachment-icon" aria-hidden="true"><FileText /></span><div><strong>{content.attachment?.name || 'Attachment'}</strong><small>{bytesLabel(content.attachment?.size)}{content.attachment?.metadataStripped ? ' · image metadata stripped' : ''}</small></div><button type="button" onClick={() => openEncryptedMedia(item)} aria-label={`Decrypt and download ${content.attachment?.name || 'attachment'}`}>Download</button></div>}
                {isVoice && <div className="voice-bubble"><button className="voice-play" type="button" onClick={() => openEncryptedMedia(item, true)} aria-label="Decrypt voice note">{mediaUrl ? <Check aria-hidden="true" /> : <Play aria-hidden="true" />}</button><div className="voice-track"><span /><span /><span /><span /><span /><span /><span /><span /></div><small>{content.attachment?.durationSeconds ? `${content.attachment.durationSeconds}s` : 'Voice note'}</small>{mediaUrl && <audio className="voice-audio" controls src={mediaUrl} preload="metadata" />}</div>}
                <div className="message-meta"><span>{timeLabel(item.sentAt)}{item.edited ? ' · edited' : ''}</span>{expiry && <span title={`Expires ${dateTimeLabel(item.expiresAt)}`}>⏱ {expiry}</span>}{status && <span className={`message-status ${status.className}`} title={status.label} aria-label={status.label}>{status.icon}</span>}</div>
              </div>
              <div className="reaction-bar">
                {(item.reactions?.length || 0) > 0 && <div className="reaction-set">{groupReactions(item.reactions, myId).map((group) => <button key={group.emoji} type="button" className={`reaction-chip ${group.mine ? 'mine' : ''}`} onClick={() => toggleReaction(item, group.emoji)} aria-pressed={group.mine} aria-label={`${group.emoji} ${group.count} reaction${group.count === 1 ? '' : 's'}${group.mine ? ' (yours) ' : ''}— toggle`} title="Click to toggle your reaction">{group.emoji}<span>{group.count}</span></button>)}</div>}
                <span className={`reaction-toggle-wrap ${reactingToId === idOf(item) ? 'open' : ''}`}>
                  <button type="button" className="reaction-toggle-button" aria-label="React to this message" aria-expanded={reactingToId === idOf(item)} onClick={() => setReactingToId(reactingToId === idOf(item) ? null : idOf(item))}><Smile aria-hidden="true" /></button>
                  {reactingToId === idOf(item) && <EmojiMenu onPick={(emoji) => { toggleReaction(item, emoji); setReactingToId(null); }} onClose={() => setReactingToId(null)} label="React to this message" />}
                </span>
              </div>
              {mine && editingId !== idOf(item) && <div className="message-actions">{content?.kind === 'text' && !content?.legacy && <button onClick={() => { setEditingId(idOf(item)); setEditText(content.text || ''); }}>Edit</button>}<button onClick={() => setConfirmDeleteId(idOf(item))}>Delete</button></div>}
            </article></Fragment>;
          })}
          {typingUsers.length > 0 && <div className="typing-bubble" role="status"><span /><span /><span /><small>{typingText}</small></div>}
          <div ref={bottomRef} />
        </div>

        {stagedFileInfo && <div className="attachment-stage">
          <div className="attachment-stage-copy"><span className="attachment-stage-icon">{stagedFileInfo.kind === 'voice' ? <Mic aria-hidden="true" /> : <Paperclip aria-hidden="true" />}</span><div><strong>{stagedFileInfo.name}</strong><small>{bytesLabel(stagedFileInfo.size)}{stagedFileInfo.metadataStripped ? ' · EXIF/GPS metadata stripped before encryption' : stagedFileInfo.kind === 'attachment' ? ' · file name/type are encrypted inside the message' : ' · recorded locally'}</small></div></div>
          {voicePreviewUrl && <audio controls src={voicePreviewUrl} preload="metadata" />}
          <div className="attachment-stage-actions"><button className="secondary-button small-button" type="button" onClick={discardStaged} disabled={sendingAttachment}>Discard</button><button className="primary-button small-button" type="button" onClick={sendStaged} disabled={!canSend || sendingAttachment}>{sendingAttachment ? 'Encrypting…' : 'Encrypt & send'}</button></div>
        </div>}

        {recording && <div className="recording-bar" role="status"><span className="recording-dot" /><strong>Recording {Math.floor(recordSeconds / 60)}:{String(recordSeconds % 60).padStart(2, '0')}</strong><span>Audio stays in this browser until you stop and choose Send.</span><button className="danger-button small-button" type="button" onClick={stopRecording}>Stop & review</button></div>}

        <form className="message-composer" onSubmit={send}>
          <input ref={fileRef} className="sr-only" type="file" onChange={chooseAttachment} />
          <div className="composer-main">
            <button className="composer-icon-button" type="button" onClick={() => fileRef.current?.click()} disabled={!canSend || recording} title="Attach encrypted file" aria-label="Attach a file"><Paperclip aria-hidden="true" /></button>
            <span className={`emoji-wrap ${showEmojiPicker ? 'open' : ''}`}>
              <button className="composer-icon-button" type="button" onClick={() => setShowEmojiPicker((v) => !v)} disabled={!canSend || recording} aria-expanded={showEmojiPicker} title="Insert emoji" aria-label="Insert an emoji"><Smile aria-hidden="true" /></button>
              {showEmojiPicker && canSend && <EmojiMenu onPick={insertEmoji} onClose={() => setShowEmojiPicker(false)} label="Insert emoji" />}
            </span>
            <textarea rows={1} value={draft} onChange={(e) => handleTyping(e.target.value)} onBlur={() => window.setTimeout(stopTyping, 100)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} placeholder={active.messagingAvailable ? `Message ${active.type === 'group' ? active.name : other?.name || ''}` : 'Messaging unavailable'} disabled={!active.messagingAvailable || recording} maxLength={10000} aria-label="Message" />
            <button className={`composer-icon-button mic-button ${recording ? 'recording' : ''}`} type="button" onClick={recording ? stopRecording : requestRecording} disabled={!canSend && !recording} title="Record encrypted voice note" aria-label={recording ? 'Stop voice recording' : 'Record a voice note'}><Mic aria-hidden="true" /></button>
            <button className="primary-button send-button" disabled={!draft.trim() || !canSend || recording} aria-label="Send encrypted message"><Send aria-hidden="true" /><span>Send</span></button>
          </div>
          {chatMode !== 'off' && <div className="composer-meta"><span>⏱ Disappearing messages: {MODES.find(([v]) => v === chatMode)?.[1]}</span></div>}
        </form>
      </>}
    </main>

    {error && <div className="floating-error error-banner" role="alert">⚠ {error}<button className="link-button" onClick={() => setError('')}>Dismiss</button></div>}
    {requestTarget && <RequestComposer target={requestTarget} encryptForUser={encryptForUser} onClose={() => setRequestTarget(null)} onSent={requestSent} />}
    {showGroupComposer && <GroupComposer conversations={conversations} myId={myId} onClose={() => setShowGroupComposer(false)} onCreated={groupCreated} />}
    {showMicExplainer && <MicrophoneExplainer onCancel={() => setShowMicExplainer(false)} onContinue={continueRecording} />}
    {showEncryptionInfo && active && <EncryptionInfo active={active} myId={myId} identity={identity} onClose={() => setShowEncryptionInfo(false)} />}
    {showConversationInfo && active && <ConversationInfo active={active} myId={myId} presence={presence} onClose={() => setShowConversationInfo(false)} onSearch={() => { setShowConversationInfo(false); setShowChatSearch(true); }} onEncryption={() => { setShowConversationInfo(false); setShowEncryptionInfo(true); }} onClear={() => { setShowConversationInfo(false); setConfirmClear(true); }} onBlock={() => { setShowConversationInfo(false); setConfirmBlock(true); }} onLeave={() => { setShowConversationInfo(false); setConfirmLeave(true); }} />}
    {confirmDeleteId && <ConfirmDialog title="Delete this message from SecureChat?" confirmLabel="Delete message" danger onCancel={() => setConfirmDeleteId(null)} onConfirm={deleteMessage}><p>The server copy and encrypted attachment, if any, are permanently removed. Devices that already downloaded or copied the content cannot be remotely controlled.</p></ConfirmDialog>}
    {confirmClear && <ConfirmDialog title="Clear this chat for you?" confirmLabel="Clear chat for me" danger onCancel={() => setConfirmClear(false)} onConfirm={clearChat}><p>Your current message and security-event history will disappear from this account. Other participants keep their history, downloaded files cannot be recalled, and new messages will appear normally.</p><p className="microcopy">This action cannot be undone for your account. It does not block anyone or leave the conversation.</p></ConfirmDialog>}
    {confirmBlock && <ConfirmDialog title={`Block ${other?.name || 'this contact'}?`} confirmLabel="Block contact" danger onCancel={() => setConfirmBlock(false)} onConfirm={blockPeer}><p>Future messages, presence and typing signals stop. Blocking is private; SecureChat does not send a “you were blocked” notification.</p></ConfirmDialog>}
    {confirmLeave && <ConfirmDialog title={`Leave ${active?.name || 'this group'}?`} confirmLabel="Leave group" danger onCancel={() => setConfirmLeave(false)} onConfirm={leaveGroup}><p>You will stop receiving new encrypted group messages and live activity. This does not delete other members' conversation history.</p></ConfirmDialog>}
  </div>;
}
