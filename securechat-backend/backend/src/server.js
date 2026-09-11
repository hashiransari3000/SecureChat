require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const connectDB = require('./utils/db');
const initSockets = require('./sockets');
const rateLimit = require('./middleware/rateLimit');

const authRoutes = require('./routes/authRoutes');
const privacyRoutes = require('./routes/privacyRoutes');
const chatRoutes = require('./routes/chatRoutes');
const userRoutes = require('./routes/userRoutes');
const dataRoutes = require('./routes/dataRoutes');
const cryptoRoutes = require('./routes/cryptoRoutes');
const attachmentRoutes = require('./routes/attachmentRoutes');
const pushRoutes = require('./routes/pushRoutes');
const { cleanupExpired } = require('./controllers/attachmentController');

const app = express();
const server = http.createServer(app);
const clientOrigin = process.env.CLIENT_URL || 'http://localhost:5173';
const allowedOrigins = [
  clientOrigin,
  'https://securechats.tech',     // custom domain (apex)
  'https://www.securechats.tech', // custom domain (www)
  'https://localhost',          // Capacitor Android WebView (securechat.app origin)
  'https://securechat.app',     // named-app WebView origin (Google Auth friendly)
  'capacitor://localhost',      // Capacitor local scheme fallback
  'http://localhost:5173',      // local dev server
  'http://localhost:5000',      // local API fallback
];
const corsOptions = {
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

const io = new Server(server, { cors: corsOptions });
app.set('io', io);

app.use(cors(corsOptions));
app.use(express.json({ limit: '150kb' }));
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  next();
});
app.use(rateLimit({ windowMs: 60_000, max: 180 }));

// Auth endpoints get a much tighter per-path budget than the general 180/min
// so credential guesses stay brutally slow even behind a shared NAT.
const authRateLimit = rateLimit({ windowMs: 60_000, max: 12 });
app.use('/auth', authRateLimit);

// Profile photos are not public static files. They are served only through
// the authenticated /users/:userId/avatar privacy check.

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'SecureChat' }));

app.use('/auth', authRoutes);
app.use('/privacy', privacyRoutes);
app.use('/', chatRoutes);
app.use('/users', userRoutes);
app.use('/data', dataRoutes);
app.use('/crypto', cryptoRoutes);
app.use('/attachments', attachmentRoutes);
app.use('/push', pushRoutes);

app.use((err, req, res, next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: req.originalUrl?.startsWith('/attachments') ? 'Encrypted attachments can be up to 25 MB.' : 'Profile photos can be up to 5 MB.' });
  if (err?.message === 'ENCRYPTED_ATTACHMENT_REQUIRED') return res.status(415).json({ error: 'Attachments must be encrypted in the browser before upload.' });
  if (err?.message === 'UNSUPPORTED_AVATAR_TYPE') return res.status(415).json({ error: 'Profile photos must be JPG, PNG, or WebP.' });
  if (err?.statusCode && err.statusCode < 500) return res.status(err.statusCode).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our end. Your requested change was not assumed to have succeeded.' });
});

initSockets(io);

const PORT = process.env.PORT || 5000;
connectDB().then(() => {
  server.listen(PORT, () => {
    console.log(`SecureChat backend running on port ${PORT}`);
    cleanupExpired().catch((e) => console.error('Attachment cleanup failed:', e.message));
    setInterval(() => cleanupExpired().catch((e) => console.error('Attachment cleanup failed:', e.message)), 60_000).unref();
  });
}).catch((error) => {
  console.error('Database connection failed:', error.message);
  process.exit(1);
});
