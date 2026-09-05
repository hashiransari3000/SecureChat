const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
const User = require('../models/User');
const PrivacySettings = require('../models/PrivacySettings');
const AuditLog = require('../models/AuditLog');
const { signToken } = require('../utils/jwt');
const { OAuth2Client } = require('google-auth-library');

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '432304486079-mdgpiraqhiciv9neskk5f34th6ib5ejl.apps.googleusercontent.com';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);
const AVATAR_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'avatars');

function publicUser(user) {
  return {
    id: user._id,
    name: user.name,
    username: user.username,
    email: user.email,
    avatarUrl: user.avatarUrl ? `/users/${String(user._id)}/avatar` : null,
  };
}

async function availableUsername(base) {
  const cleaned = String(base || 'secure_user').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24) || 'secure_user';
  const validBase = cleaned.length >= 3 ? cleaned : `${cleaned}_user`;
  if (!(await User.exists({ username: validBase }))) return validBase;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${validBase.slice(0, 26)}${suffix}`;
    if (!(await User.exists({ username: candidate }))) return candidate;
  }
  return `secure_user_${crypto.randomBytes(3).toString('hex')}`;
}

async function downloadGoogleAvatar(pictureUrl, userId) {
  if (!pictureUrl) return null;
  let parsed;
  try { parsed = new URL(pictureUrl); } catch { return null; }
  const trustedHost = parsed.protocol === 'https:' && (parsed.hostname.endsWith('.googleusercontent.com') || parsed.hostname.endsWith('.ggpht.com'));
  if (!trustedHost) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(parsed, { signal: controller.signal, redirect: 'error' });
    if (!response.ok) return null;
    const declaredSize = Number(response.headers.get('content-length') || 0);
    if (declaredSize > 5 * 1024 * 1024) return null;
    const input = Buffer.from(await response.arrayBuffer());
    if (!input.length || input.length > 5 * 1024 * 1024) return null;
    await fs.mkdir(AVATAR_DIR, { recursive: true });
    const filename = `${String(userId)}-google-${crypto.randomBytes(8).toString('hex')}.webp`;
    await sharp(input, { failOn: 'error' }).rotate().resize(512, 512, { fit: 'cover', position: 'attention', withoutEnlargement: true }).webp({ quality: 84 }).toFile(path.join(AVATAR_DIR, filename));
    return `/uploads/avatars/${filename}`;
  } catch { return null; }
  finally { clearTimeout(timeout); }
}

async function syncGoogleProfile(user, payload) {
  const oldAvatar = user.avatarUrl;
  user.name = String(payload.name || user.name).trim();
  user.firstName = payload.given_name || user.firstName || null;
  user.lastName = payload.family_name || user.lastName || null;
  if (payload.picture && payload.picture !== user.googlePictureUrl) {
    const localAvatar = await downloadGoogleAvatar(payload.picture, user._id);
    if (localAvatar) {
      user.avatarUrl = localAvatar;
      user.googlePictureUrl = payload.picture;
    }
  }
  await user.save();
  if (oldAvatar && oldAvatar !== user.avatarUrl && oldAvatar.startsWith('/uploads/avatars/')) {
    await fs.unlink(path.join(AVATAR_DIR, path.basename(oldAvatar))).catch(() => {});
  }
  return user;
}

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
      user: publicUser(user),
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
    if (!user || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'The email or password is incorrect.' });
    }

    await AuditLog.create({ userId: user._id, action: 'login', detail: {} });
    res.json({ token: signToken(user._id), user: publicUser(user) });
  } catch (e) { next(e); }
};

exports.google = async (req, res, next) => {
  try {
    const credential = String(req.body.credential || '');
    if (!credential) return res.status(400).json({ error: 'Google did not return a sign-in credential. Please try again.' });

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
      payload = ticket.getPayload();
    } catch {
      return res.status(401).json({ error: 'Google sign-in could not be verified. Please try again.' });
    }

    const googleSub = String(payload?.sub || '');
    const email = String(payload?.email || '').toLowerCase();
    if (!googleSub || !email || payload?.email_verified !== true) {
      return res.status(401).json({ error: 'A verified Google email address is required.' });
    }

    let user = await User.findOne({ $or: [{ googleSub }, { email }] }).select('+googleSub +googlePictureUrl');
    if (user) {
      if (user.googleSub && user.googleSub !== googleSub) {
        return res.status(409).json({ error: 'This email is already connected to another Google identity.' });
      }
      if (!user.googleSub) user.googleSub = googleSub;
      await syncGoogleProfile(user, payload);
      await AuditLog.create({ userId: user._id, action: 'google_login', detail: {} });
      return res.json({ token: signToken(user._id), user: publicUser(user), isNewUser: false, message: `Welcome back, ${user.firstName || user.name}!` });
    }

    const requestedUsername = String(req.body.username || '').toLowerCase().trim();
    if (!requestedUsername) {
      const suggestion = await availableUsername(payload.given_name || payload.name || email.split('@')[0]);
      return res.status(422).json({
        code: 'GOOGLE_USERNAME_REQUIRED',
        error: 'Choose a public username to finish creating your account.',
        profile: { name: payload.name || email.split('@')[0], email, suggestedUsername: suggestion },
      });
    }
    const usernameError = validateUsername(requestedUsername);
    if (usernameError) return res.status(400).json({ error: usernameError });
    if (await User.exists({ username: requestedUsername })) return res.status(409).json({ error: 'That username is already taken.' });

    user = await User.create({
      name: String(payload.name || email.split('@')[0]).trim(),
      firstName: payload.given_name || null,
      lastName: payload.family_name || null,
      username: requestedUsername,
      email,
      googleSub,
      passwordHash: null,
    });
    user = await User.findById(user._id).select('+googleSub +googlePictureUrl');
    await syncGoogleProfile(user, payload);
    await PrivacySettings.create({ userId: user._id });
    await AuditLog.create({ userId: user._id, action: 'google_signup', detail: { consentedUsername: true } });
    return res.status(201).json({ token: signToken(user._id), user: publicUser(user), isNewUser: true, message: `Welcome to SecureChat, ${user.firstName || user.name}!` });
  } catch (e) { next(e); }
};

exports.logout = async (req, res) => res.json({ message: 'Logged out successfully.' });

exports.forgotPassword = async (req, res, next) => {
  try {
    const email = String(req.body.email || '').toLowerCase();
    if (!email) return res.status(400).json({ error: 'Please enter your email address.' });
    const genericResponse = { message: 'If an account with that email exists, a password reset link has been sent.' };
    const user = await User.findOne({ email }).select('+passwordHash');
    if (!user || !user.passwordHash) return res.json(genericResponse);

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
