const mongoose = require('mongoose');

const cryptoDeviceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  deviceId: { type: String, required: true, trim: true, maxlength: 120 },
  publicKeyJwk: { type: mongoose.Schema.Types.Mixed, required: true },
  fingerprint: { type: String, required: true, trim: true, maxlength: 128 },
  active: { type: Boolean, default: true },
  lastSeenAt: { type: Date, default: Date.now },
}, { timestamps: true });

cryptoDeviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
cryptoDeviceSchema.index({ userId: 1, active: 1 });

module.exports = mongoose.model('CryptoDevice', cryptoDeviceSchema);
