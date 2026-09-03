const mongoose = require('mongoose');

// Small, purpose-limited activity records shown inside accepted chats so users
// understand security/privacy state changes that affect the interaction.
const conversationEventSchema = new mongoose.Schema(
  {
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: [
        'chat_accepted',
        'group_created',
        'group_joined',
        'group_left',
        'read_receipts_changed',
        'typing_changed',
        'presence_changed',
        'profile_photo_visibility_changed',
        'disappearing_changed',
      ],
      required: true,
    },
    // Human-readable copy is kept intentionally generic; sensitive setting
    // values are not stored here unless the effect must be explained.
    text: { type: String, required: true, maxlength: 300 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

conversationEventSchema.index({ conversationId: 1, createdAt: 1 });

module.exports = mongoose.model('ConversationEvent', conversationEventSchema);
