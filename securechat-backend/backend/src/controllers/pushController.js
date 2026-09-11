const PushToken = require('../models/PushToken');

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

module.exports = { registerToken, unregisterToken };