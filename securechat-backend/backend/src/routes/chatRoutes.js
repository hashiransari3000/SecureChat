const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const conversationController = require('../controllers/conversationController');
const messageController = require('../controllers/messageController');

router.use(requireAuth);

router.get('/conversations', conversationController.listConversations);
router.get('/conversations/requests', conversationController.listRequests);
router.get('/conversations/requests/sent', conversationController.listSentRequests);
router.post('/conversations', conversationController.startConversation);
router.post('/conversations/:conversationId/accept', conversationController.acceptRequest);
router.post('/conversations/:conversationId/decline', conversationController.declineRequest);
router.delete('/conversations/:conversationId/request', conversationController.cancelRequest);
router.patch('/conversations/:conversationId/disappearing', conversationController.updateDisappearingMode);
router.delete('/conversations/:conversationId/history', conversationController.clearChat);
router.get('/conversations/:conversationId/events', conversationController.listEvents);

router.get('/groups/invites', conversationController.listGroupInvites);
router.post('/groups', conversationController.createGroup);
router.post('/groups/:conversationId/accept', conversationController.acceptGroupInvite);
router.post('/groups/:conversationId/decline', conversationController.declineGroupInvite);
router.post('/groups/:conversationId/leave', conversationController.leaveGroup);

router.get('/conversations/:conversationId/messages', messageController.getMessages);
router.post('/conversations/:conversationId/messages', messageController.sendMessage);
router.get('/messages/:messageId', messageController.getMessageById);
router.patch('/messages/:id', messageController.editMessage);
router.delete('/messages/:id', messageController.deleteMessage);
router.post('/messages/:id/read', messageController.markRead);
router.post('/messages/:id/reactions', messageController.toggleReaction);

module.exports = router;
