const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/User');
const PrivacySettings = require('../models/PrivacySettings');
const AuditLog = require('../models/AuditLog');
const { signToken } = require('../utils/jwt');

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

function validateUsername(username) {
  if (!/^[a-zA-Z0-9_]{3,30}$/.test(username || '')) return 'Username must be 3–30 characters and use only letters, numbers, or underscores.';
  return null;
}

function validateSignup({ name, username, email, password }) {
  if (!name || name.trim().length < 2) return 'Please enter your full name.';
  const usernameError = validateUsername(username);
  if (usernameError) return usernameError;
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return 'Please enter a valid email address.';
  if (!password || password.length < 8) return 'Your password should contain at least 8 characters.';
  return null;
}

exports.signup = async (req, res, next) => {
  try {
    const { name, username, email, password, phone } = req.body;
    const validationError = validateSignup({ name, username, email, password });
    if (validationError) return res.status(400).json({ error: validationError });

    const normalizedUsername = username.toLowerCase();
    const normalizedEmail = email.toLowerCase();
    const existing = await User.findOne({ $or: [{ email: normalizedEmail }, { username: normalizedUsername }] });
    if (existing) return res.status(409).json({ error: existing.username === normalizedUsername ? 'That username is already taken.' : 'An account with this email already exists.' });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      name: name.trim(),
      username: normalizedUsername,
      email: normalizedEmail,
      passwordHash,
      phone: phone?.trim() || null,
    });
    await PrivacySettings.create({ userId: user._id });
    await AuditLog.create({ userId: user._id, action: 'signup', detail: {} });

    res.status(201).json({
      token: signToken(user._id),
      user: { id: user._id, name: user.name, username: user.username, email: user.email, avatarUrl: user.avatarUrl ? `/users/${String(user._id)}/avatar` : null },
    });
  } catch (e) { next(e); }
};

exports.login = async (req, res, next) => {
  try {
    const email = String(req.body.email || '').toLowerCase();
    const password = String(req.body.password || '');
    if (!email || !password) return res.status(400).json({ error: 'Please enter your email and password.' });

    const user = await User.findOne({ email }).select('+passwordHash');
    // Same response for both cases avoids account enumeration.
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'The email or password is incorrect.' });
    }

    await AuditLog.create({ userId: user._id, action: 'login', detail: {} });
    res.json({ token: signToken(user._id), user: { id: user._id, name: user.name, username: user.username, email: user.email, avatarUrl: user.avatarUrl ? `/users/${String(user._id)}/avatar` : null } });
  } catch (e) { next(e); }
};

exports.logout = async (req, res) => res.json({ message: 'Logged out successfully.' });

exports.forgotPassword = async (req, res, next) => {
  try {
    const email = String(req.body.email || '').toLowerCase();
    if (!email) return res.status(400).json({ error: 'Please enter your email address.' });
    const genericResponse = { message: 'If an account with that email exists, a password reset link has been sent.' };
    const user = await User.findOne({ email });
    if (!user) return res.json(genericResponse);

    const rawToken = crypto.randomBytes(32).toString('hex');
    user.resetTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    user.resetTokenExpiry = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await user.save();

    const devResetLink = process.env.NODE_ENV !== 'production'
      ? `${process.env.CLIENT_URL || 'http://localhost:5173'}/reset-password?token=${rawToken}&email=${encodeURIComponent(user.email)}`
      : undefined;
    res.json({ ...genericResponse, ...(devResetLink ? { devResetLink } : {}) });
  } catch (e) { next(e); }
};

exports.resetPassword = async (req, res, next) => {
  try {
    const { email, token, newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Your new password should contain at least 8 characters.' });

    const user = await User.findOne({ email: String(email || '').toLowerCase() }).select('+resetTokenHash +resetTokenExpiry');
    if (!user || !user.resetTokenHash || !user.resetTokenExpiry) return res.status(400).json({ error: 'This reset link is invalid or has already been used.' });
    if (user.resetTokenExpiry < new Date()) return res.status(400).json({ error: 'This reset link has expired. Please request a new one.' });

    const tokenHash = crypto.createHash('sha256').update(token || '').digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(tokenHash), Buffer.from(user.resetTokenHash))) return res.status(400).json({ error: 'This reset link is invalid or has already been used.' });

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.resetTokenHash = null;
    user.resetTokenExpiry = null;
    await user.save();
    res.json({ message: 'Your password has been reset. You can now log in.' });
  } catch (e) { next(e); }
};
