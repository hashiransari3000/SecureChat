const mongoose = require('mongoose');
const User = require('../models/User');
const PrivacySettings = require('../models/PrivacySettings');
const Conversation = require('../models/Conversation');

function slugifyName(name) {
  const base = String(name || 'user').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'user';
  return base;
}

async function backfillUsernames() {
  const users = await User.find({ $or: [{ username: { $exists: false } }, { username: null }] }).select('_id name');
  for (const user of users) {
    const base = slugifyName(user.name);
    let username = base;
    let suffix = 1;
    while (await User.exists({ username })) username = `${base}${suffix++}`;
    await User.updateOne({ _id: user._id }, { $set: { username } });
  }
}

async function backfillPrivacySettings() {
  const users = await User.find({}).select('_id');
  const existing = new Set((await PrivacySettings.find({ userId: { $in: users.map((u) => u._id) } }).select('userId')).map((p) => String(p.userId)));
  const missing = users.filter((u) => !existing.has(String(u._id)));
  if (missing.length) await PrivacySettings.insertMany(missing.map((u) => ({ userId: u._id })));
}

module.exports = async function connectDB() {
  await mongoose.connect(process.env.MONGO_URI);
  await backfillUsernames();
  await backfillPrivacySettings();
  await Conversation.updateMany({ type: { $exists: false } }, { $set: { type: 'direct', pendingParticipantIds: [], adminIds: [] } });
  console.log('MongoDB connected');
};
