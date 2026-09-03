const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    // Username is the only public discovery identifier. email remains login-only.
    username: {
      type: String,
      required: true,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
      minlength: 3,
      maxlength: 30,
      match: /^[a-z0-9_]+$/,
    },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    phone: { type: String, default: null },
    avatarUrl: { type: String, default: null },
    resetTokenHash: { type: String, default: null, select: false },
    resetTokenExpiry: { type: Date, default: null, select: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
