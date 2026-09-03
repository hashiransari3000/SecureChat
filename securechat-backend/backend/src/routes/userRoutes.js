const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const avatarUpload = require('../middleware/avatarUpload');
const userController = require('../controllers/userController');

router.use(requireAuth);
router.get('/me', userController.getMe);
router.get('/:userId/avatar', userController.getAvatar);
router.patch('/me', userController.updateMe);
router.post('/me/avatar', avatarUpload.single('avatar'), userController.uploadAvatar);
router.delete('/me/avatar', userController.deleteAvatar);
router.get('/search', userController.searchUsers);
router.get('/blocked', userController.listBlockedUsers);
router.post('/:userId/block', userController.blockUser);
router.delete('/:userId/block', userController.unblockUser);

module.exports = router;
