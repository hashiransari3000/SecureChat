const mongoose = require('mongoose');

const privacySettingsSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },

    // Privacy-by-default discovery and social telemetry controls.
    discoverability: { type: String, enum: ['everyone', 'nobody'], default: 'everyone' },
    onlineStatus: { type: String, enum: ['visible', 'hidden'], default: 'visible' },
    profilePhotoVisibility: { type: String, enum: ['everyone', 'connections'], default: 'connections' },
    readReceipts: { type: Boolean, default: true },
    showTypingStatus: { type: Boolean, default: true },

    // Notification content is deliberately independent from browser permission.
    notificationPrivacyLevel: {
      type: String,
      enum: ['detailed', 'sender_only', 'anonymous'],
      default: 'sender_only',
    },
    notificationsEnabled: { type: Boolean, default: false },

    // Local app-lock configuration is synced; the PIN itself never leaves the browser.
    appLockTimeout: { type: String, enum: ['off', '5m', '15m', '30m'], default: 'off' },

    defaultDisappearingMessages: {
      type: String,
      enum: ['off', '1h', '1d', '7d'],
      default: 'off',
    },

    // Explicit opt-in only; the default build has no analytics collector enabled
    analyticsAllowed: { type: Boolean, default: false },

    // Universal-design preferences.
    textSize: { type: String, enum: ['small', 'medium', 'large'], default: 'medium' },
    highContrast: { type: Boolean, default: false },
    reducedMotion: { type: Boolean, default: false },
    theme: { type: String, enum: ['system', 'light', 'dark'], default: 'system' },

    // Blocking is private account state. It is never exposed to another user.
    blockedUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);

module.exports = mongoose.model('PrivacySettings', privacySettingsSchema);
