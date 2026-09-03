const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['direct', 'group'], default: 'direct', index: true },
    name: { type: String, default: null, trim: true, maxlength: 60 },
    participantIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
    pendingParticipantIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    adminIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // Direct-chat consent state. Group chats use pendingParticipantIds for invitations.
    requesterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    status: { type: String, enum: ['pending', 'accepted'], default: 'pending' },
    acceptedAt: { type: Date, default: null },

    // Applies to messages created after the setting is changed.
    disappearingMode: { type: String, enum: ['off', '1h', '1d', '7d'], default: 'off' },
    lastMessageAt: { type: Date, default: null },
    // Per-user visibility boundary for Clear Chat. Shared records are retained
    // for other participants; this user only receives content sent afterwards.
    clearedFor: [{
      _id: false,
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      clearedAt: { type: Date, required: true },
    }],
  },
  { timestamps: true }
);

conversationSchema.index({ participantIds: 1 });
conversationSchema.index({ status: 1, participantIds: 1 });
conversationSchema.index({ participantIds: 1, lastMessageAt: -1 });
conversationSchema.index({ pendingParticipantIds: 1, type: 1 });

module.exports = mongoose.model('Conversation', conversationSchema);
