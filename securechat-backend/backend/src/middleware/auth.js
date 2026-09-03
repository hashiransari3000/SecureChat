const { verifyToken } = require('../utils/jwt');

// Reads "Authorization: Bearer <token>", verifies it, attaches req.userId.
// Every private route in the app goes through this — privacy enforcement
// has to happen here, not in the frontend.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'No token provided. Please log in.' });
  }

  try {
    const decoded = verifyToken(token);
    req.userId = decoded.sub;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }
}

module.exports = requireAuth;
