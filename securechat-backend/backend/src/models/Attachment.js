const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema({
  ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
  messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null, index: true },
  storageName: { type: String, required: true },
  size: { type: Number, required: true, min: 1 },
  expiresAt: { type: Date, required: true, index: true },
}, { timestamps: true });

module.exports = mongoose.model('Attachment', attachmentSchema);
