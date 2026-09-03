const mongoose = require('mongoose');

// Every export, deletion, and privacy change gets a timestamped record.
// This is what lets the app back up its "we take your data seriously"
// claim with something concrete rather than just a privacy policy page.
const auditLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    action: {
      type: String,
      enum: ['data_exported', 'account_deleted', 'privacy_changed', 'login', 'signup'],
      required: true,
    },
    detail: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: 'timestamp', updatedAt: false } }
);

module.exports = mongoose.model('AuditLog', auditLogSchema);
