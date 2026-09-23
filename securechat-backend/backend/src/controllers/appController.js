const AppMeta = require('../models/AppMeta');

// Public: returns the latest published app version metadata so clients can
// decide whether an update is available.
async function getLatest(req, res) {
  try {
    const meta = await AppMeta.findOne({ singleton: 'latest' }).lean();
    const fallback = { versionName: '1.2.1', versionCode: 5, apkUrl: '', notes: '' };
    res.json(meta || fallback);
  } catch (err) {
    res.status(500).json({ error: 'Could not read version metadata.' });
  }
}

// Admin-only: records the latest published version so the app can prompt users.
async function setVersion(req, res) {
  const key = String(req.headers['x-admin-key'] || '');
  const expected = process.env.ADMIN_KEY || '';
  if (!expected || key !== expected) {
    return res.status(403).json({ error: 'Invalid or missing admin key.' });
  }
  const versionName = String(req.body?.versionName || '').trim();
  const versionCode = parseInt(String(req.body?.versionCode || ''), 10);
  const apkUrl = String(req.body?.apkUrl || '').trim();
  const notes = String(req.body?.notes || '').trim();
  if (!versionName || !Number.isInteger(versionCode) || versionCode < 1) {
    return res.status(400).json({ error: 'versionName and a positive versionCode are required.' });
  }
  if (apkUrl && !/^https:\/\/[^ ]+\.apk$/i.test(apkUrl)) {
    return res.status(400).json({ error: 'apkUrl must be an https URL ending in .apk.' });
  }
  try {
    await AppMeta.updateOne(
      { singleton: 'latest' },
      { $set: { versionName, versionCode, apkUrl, notes: notes.slice(0, 500) } },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[appmeta] failed to record version:', err.message);
    res.status(500).json({ error: 'Could not record app version.' });
  }
}

module.exports = { getLatest, setVersion };