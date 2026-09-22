const PushToken = require('../models/PushToken');
const { pushAnnouncement } = require('../utils/push');

// Registers (or updates) the FCM token for an authenticated user. Tokens are
// device-scoped; each token belongs to exactly one user, so old owner links
// are removed if a token is reused.
async function registerToken(req, res) {
  const token = String(req.body?.token || '').trim();
  const platform = req.body?.platform === 'ios' ? 'ios' : 'android';
  if (!token || token.length < 40 || token.length > 512) {
    return res.status(400).json({ error: 'A valid push token is required.' });
  }
  try {
    await PushToken.updateOne(
      { token },
      { $set: { token, userId: req.userId, platform } },
      { upsert: true }
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('[push] token registration failed:', err.message);
    res.status(500).json({ error: 'Could not register this device for push.' });
  }
}

async function unregisterToken(req, res) {
  const token = String(req.body?.token || '').trim();
  if (!token) return res.status(400).json({ error: 'A push token is required.' });
  try {
    await PushToken.deleteOne({ token, userId: req.userId });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not unregister this device.' });
  }
}

// Admin-only: broadcasts an announcement (with a destination URL) to every
// registered device. Guarded by an API key in the Authorization header.
async function broadcastAnnouncement(req, res) {
  const key = String(req.headers['x-admin-key'] || '');
  const expected = process.env.ADMIN_KEY || '';
  if (!expected || key !== expected) {
    return res.status(403).json({ error: 'Invalid or missing admin key.' });
  }
  const title = String(req.body?.title || 'SecureChat').trim().slice(0, 80) || 'SecureChat';
  const body = String(req.body?.body || '').trim().slice(0, 180);
  const url = String(req.body?.url || '').trim();
  if (!body) return res.status(400).json({ error: 'A notification body is required.' });
  if (!/^https:\/\/[^ ]+$/.test(url)) return res.status(400).json({ error: 'A valid https URL is required.' });
  if (!/^https:\/\/github\.com/i.test(url)) return res.status(400).json({ error: 'Only GitHub URLs are allowed for downloads.' });
  try {
    const sent = await pushAnnouncement({ title, body, url });
    res.json({ ok: true, sent, total: sent });
  } catch (err) {
    console.error('[push] broadcast failed:', err.message);
    res.status(500).json({ error: 'Broadcast failed.' });
  }
}

module.exports = { registerToken, unregisterToken, broadcastAnnouncement };