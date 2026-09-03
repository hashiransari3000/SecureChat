const PrivacySettings = require('../models/PrivacySettings');
const Conversation = require('../models/Conversation');

function includesId(list, id) {
  return (list || []).some((value) => String(value) === String(id));
}

async function getPairPrivacy(userA, userB) {
  const [a, b] = await Promise.all([
    PrivacySettings.findOne({ userId: userA }),
    PrivacySettings.findOne({ userId: userB }),
  ]);
  return { a, b };
}

async function isBlockedEither(userA, userB) {
  const { a, b } = await getPairPrivacy(userA, userB);
  return includesId(a?.blockedUserIds, userB) || includesId(b?.blockedUserIds, userA);
}

async function areConnected(userA, userB) {
  return !!(await Conversation.exists({
    participantIds: { $all: [userA, userB], $size: 2 },
    status: 'accepted',
  }));
}

function canSeeProfilePhoto(ownerSettings, connected) {
  return ownerSettings?.profilePhotoVisibility === 'everyone' || connected;
}

module.exports = {
  includesId,
  getPairPrivacy,
  isBlockedEither,
  areConnected,
  canSeeProfilePhoto,
};
