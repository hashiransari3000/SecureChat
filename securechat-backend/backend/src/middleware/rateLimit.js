const buckets = new Map();

module.exports = function rateLimit({ windowMs = 60_000, max = 120 } = {}) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const entry = buckets.get(key);
    if (!entry || now - entry.start >= windowMs) {
      buckets.set(key, { start: now, count: 1 });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
    next();
  };
};
