# SecureChat backend

Express + MongoDB + Socket.IO API for SecureChat.

Run:

```bash
cp .env.example .env
npm install
npm run dev
```

The API runs on `http://localhost:5000` by default.

- New chat content uses browser-side E2EE; this server stores ciphertext and
  operational metadata, never message or attachment plaintext.
- Profile images are privacy-gated rather than publicly served.
- Encrypted attachments are stored as opaque bytes.
- CORS is locked to an explicit origin allowlist in `src/server.js` (web app,
  Capacitor app origin and local-dev fallbacks).
- Auth endpoints are rate-limited separately (12/min per IP+path) in addition
  to the global budget.

See the root [`README.md`](../../README.md) for the full quickstart and
[`../../DEPLOYMENT.md`](../../DEPLOYMENT.md) for production setup.