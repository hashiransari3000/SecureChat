const mongoose = require('mongoose');

const appMetaSchema = new mongoose.Schema(
  {
    singleton: { type: String, default: 'latest', unique: true },
    versionName: { type: String, default: '1.0.0' },
    versionCode: { type: Number, default: 1 },
    apkUrl: { type: String, default: '' },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AppMeta', appMetaSchema);