# SecureChat — HCI + Data Ethics + Browser E2EE Build

SecureChat is an academic privacy-by-design chat application built with React, Express, Socket.IO and MongoDB. The implementation treats privacy choices as working interaction controls rather than decorative settings.

## Start here (Windows)

### 1. Backend
```bat
cd securechat-backend\backend
copy .env.example .env
npm install
npm run dev
```
Before a real deployment, replace `JWT_SECRET` in `.env` with a long random secret and use a protected MongoDB connection. The default example expects local MongoDB on `mongodb://127.0.0.1:27017/securechat`.

Expected console output:
```text
MongoDB connected
SecureChat backend running on port 5000
```

### 2. Frontend
Open a second terminal:
```bat
cd securechat-frontend\frontend
npm install
npm run dev
```
Then open `http://localhost:5173`.

`localhost` counts as a secure browser context for Web Crypto and microphone APIs in modern browsers.

## Best two-user demo
Use two separate browser profiles (or a normal window plus an InPrivate/Incognito window). This gives each account independent local storage, E2EE device keys and Socket.IO sessions.

1. Create/login to both accounts and leave each page open once so its encrypted browser device registers.
2. Account A searches Account B by the **exact username**.
3. A sends a one-message encrypted Chat Request. Before B accepts, A gets no Delivered/Seen/presence/typing telemetry and B's profile photo is hidden from A during the pending request.
4. B accepts. Open the conversation on both sides.
5. Type and send messages to demonstrate Online, mutual Typing, Sent `✓`, Delivered `✓✓`, and Seen `✓✓`.
6. Turn Read Receipts off on either account. Affected messages never reveal Seen later, even if the setting is turned back on.
7. Turn Typing Indicators off on either account. Typing events stop at both the client source and server relay boundary.
8. Upload a profile photo. Images are decoded/re-encoded as WebP to strip EXIF/GPS/camera metadata. Photo retrieval is authenticated and re-checks the current visibility rule.
9. Create a group. Invitees remain pending and receive no prior group content until they explicitly accept; content sent before acceptance is not returned later.
10. Send an attachment or voice note. Bytes are encrypted in the browser before upload; the server receives opaque ciphertext.
11. Change disappearing messages and show the in-chat system event and expiry behavior.
12. Open chat Encryption Details and compare device fingerprints.
13. Demonstrate notification permission explanation, App Lock, encrypted data export, and password + exact `DELETE` account wipe.

## End-to-end encryption boundary
New message bodies, attachment bytes and voice notes are encrypted **before they leave the browser**.

- Each message uses a fresh AES-256-GCM content key.
- That content key is wrapped separately to registered participant browser devices with RSA-OAEP/SHA-256.
- Browser private keys are non-extractable `CryptoKey` objects stored in IndexedDB and are never uploaded.
- Device IDs are account-scoped and key envelopes identify both user and device to avoid ambiguity when several accounts use one browser profile.
- The server stores ciphertext, IVs, wrapped content keys and operational metadata.
- Old plaintext messages from the original codebase remain readable as legacy records and are visibly labeled `Legacy · not E2EE` rather than silently pretending they were encrypted.

### Important limitation
This is **not the Signal Protocol**. It does not implement Double Ratchet forward secrecy, sealed sender or a pre-key protocol, and a malicious server could theoretically substitute public keys. Users can open Encryption Details and compare device fingerprints out-of-band. Conversation membership, group names, timestamps, delivery metadata and account data remain server-visible.

## Implemented chat features
- Responsive desktop split-pane and mobile single-thread navigation.
- Light / Dark / System appearance.
- Exact username discovery only; no partial-user or email search.
- Direct Chat Requests: Accept / Decline / sender Cancel.
- Group creation with explicit per-member invitation consent.
- Browser E2EE text messaging.
- Encrypted file/image attachments with client-side image metadata stripping before encryption.
- Encrypted voice recording with contextual microphone permission explanation and local preview before Send.
- Realtime online/presence state with Visible / Hidden privacy choice and no last-seen history.
- Privacy-first typing indicator requiring both sides to allow it.
- Sent / Delivered / Seen receipt state; Seen requires applicable mutual consent.
- Message edit and permanent delete-for-active-participants.
- Local conversation search (decrypted text is searched in browser; search terms are not sent to server).
- Unread counts and request/group filters.
- Global + per-chat disappearing messages: Off / 1 hour / 1 day / 7 days.
- Block / unblock and Leave Group.
- In-chat privacy/security events.
- Device fingerprints and explicit E2EE limitation disclosure.

## Data Ethics controls
- **Data minimization:** exact username discovery, no last-seen history, no active analytics collector, opaque encrypted attachment storage.
- **Purpose limitation:** email is login/recovery data, never a public search field.
- **Granular consent:** discoverability, profile photo, presence, read receipts, typing, notifications, retention, analytics and App Lock are independent controls.
- **Consent before telemetry:** pending direct requests and pending group invitations do not receive live attention telemetry.
- **Privacy-aware notifications:** Detailed / Sender Only / Anonymous lock-screen content levels, with an explainer before browser permission.
- **Profile sovereignty:** Everyone / Connections Only; Connections Only is based on an accepted direct connection, not merely sharing a group.
- **Protected profile photos:** avatar files are not public static assets; the authenticated avatar endpoint checks visibility and block state on every request.
- **Metadata stripping:** profile images are re-encoded server-side; chat images are canvas-re-encoded client-side before E2EE upload when possible.
- **Data portability:** password-derived AES-256-GCM encrypted JSON archive. Non-extractable browser private keys are intentionally not server-exportable.
- **Right to erasure:** current password + exact `DELETE` confirmation; direct conversations and owned data are hard-deleted, while unrelated data belonging to remaining group members is preserved.

## HCI implementation
The optional `⋮ → Project notes · HCI & Ethics` screen is intentionally not part of the normal primary navigation. It exists as course/viva evidence.

The working UI maps to lecture principles including Learnability, Flexibility, Robustness, Predictability, Synthesizability, Familiarity, Generalizability, Consistency, Dialog Initiative, Multithreading, Task Migratability, Substitutivity, Customizability, Observability, Recoverability, Responsiveness and Task Conformance. It also maps the Shneiderman and Norman design rules used in the course.

Visible product examples include:
- system status: socket state, E2EE device state, presence, typing, receipts, expiry;
- error prevention: protected deletion, confirm block/delete/leave flows, request consent boundaries;
- recognition over recall: familiar chat list/thread/composer patterns and labeled controls;
- internal locus of control: privacy choices are reversible except explicitly destructive actions;
- cognitive-load reduction: advanced project rationale is hidden in the overflow menu rather than placed in normal user navigation;
- accessibility/universal design: responsive layout, keyboard focus, minimum target sizes, text sizing, high contrast and reduced motion;
- feedback/recovery: human-readable errors, connection status and clear completion messages.

The High Contrast / Reduced Motion controls do not participate in the chat auto-scroll dependency, preventing the previous white-space/bottom jump when accessibility settings change.

## Profile photo workflow
Open `Profile` from the top-right `⋮` menu or profile chip, then choose **Add profile photo** / **Replace photo** / **Remove photo**. The photo privacy setting lives under `Privacy → Profile photo visibility`.

## Dependency note
The backend uses `multer` and `sharp` for encrypted upload handling and privacy-safe image processing. Run `npm install` after extracting the ZIP. `node_modules` is intentionally not distributed because native packages such as Sharp must be installed for the target OS.

## Verification performed before packaging
- Every backend JavaScript source file passes `node --check`.
- Every frontend JS/JSX source file parses through TypeScript's JSX parser with zero syntax diagnostics.
- Relative frontend/backend import paths were checked for missing local files.
- Controller event types were reconciled with Mongoose enums.
- Privacy theme updates, group invitation history boundary, account-scoped E2EE device envelopes, voice-note duration, URL cleanup and authenticated avatar visibility were specifically regression-audited.

A full Vite/MongoDB end-to-end runtime could not be executed inside the packaging environment because npm registry access is unavailable and the original uploaded `node_modules` contains a platform-specific Rolldown binding for a different OS. Run `npm install` locally, as above; the project intentionally ships without platform-specific `node_modules`.
