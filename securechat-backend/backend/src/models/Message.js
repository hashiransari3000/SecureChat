const mongoose = require('mongoose');

const wrappedKeySchema = new mongoose.Schema({
  // userId + deviceId makes a key envelope unambiguous even when multiple
  // accounts have been used in the same browser profile. Optional preserves
  // readability of legacy v1 envelopes created before this field existed.
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  deviceId: { type: String, required: true, maxlength: 120 },
  wrappedKey: { type: String, required: true, maxlength: 4096 },
}, { _id: false });

const receiptSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  deliveredAt: { type: Date, default: null },
  readAt: { type: Date, default: null },
  readReceiptEligible: { type: Boolean, default: true },
}, { _id: false });

const attachmentRefSchema = new mongoose.Schema({
  attachmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Attachment', required: true },
  encryptedSize: { type: Number, required: true, min: 1 },
  iv: { type: String, required: true, maxlength: 256 },
}, { _id: false });

const messageSchema = new mongoose.Schema(
  {
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // Legacy plaintext field. New clients send encrypted envelopes only.
    text: { type: String, default: null, maxlength: 10000 },
    e2eeVersion: { type: Number, default: 0 },
    ciphertext: { type: String, default: null, maxlength: 30000 },
    iv: { type: String, default: null, maxlength: 256 },
    wrappedKeys: { type: [wrappedKeySchema], default: [] },
    contentKind: { type: String, enum: ['text', 'attachment', 'voice'], default: 'text' },
    attachment: { type: attachmentRefSchema, default: null },

    // Aggregate timestamps preserve the simple 1:1 UI and are derived from
    // the per-recipient receipts for new messages.
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
    readReceiptEligible: { type: Boolean, default: true },
    deliveryReceipts: { type: [receiptSchema], default: [] },

    expiresAt: { type: Date, default: null },
    edited: { type: Boolean, default: false },
    deleted: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: 'sentAt', updatedAt: true } }
);

messageSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $type: 'date' } } }
);
messageSchema.index({ conversationId: 1, sentAt: -1 });
messageSchema.index({ 'deliveryReceipts.userId': 1, 'deliveryReceipts.deliveredAt': 1 });

module.exports = mongoose.model('Message', messageSchema);
