const mongoose = require('mongoose');

const pushTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    token: { type: String, required: true, unique: true },
    platform: { type: String, enum: ['android', 'ios'], default: 'android' },
  },
  { timestamps: true }
);

pushTokenSchema.index({ userId: 1, token: 1 });

module.exports = mongoose.model('PushToken', pushTokenSchema);