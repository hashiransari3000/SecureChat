# SecureChat backend

Express + MongoDB + Socket.IO API for the SecureChat HCI/Data Ethics build.

Run:
```bat
copy .env.example .env
npm install
npm run dev
```

New chat content uses browser-side E2EE; this server stores ciphertext and operational metadata. Profile images are privacy-gated rather than publicly served, and encrypted attachments are stored as opaque bytes.

See `../../IMPLEMENTATION_GUIDE.md` for the architecture, security boundary and demo flow.
