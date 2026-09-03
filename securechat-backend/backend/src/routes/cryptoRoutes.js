const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const cryptoController = require('../controllers/cryptoController');

router.use(requireAuth);
router.post('/devices', cryptoController.registerDevice);
router.get('/devices', cryptoController.listMyDevices);
router.delete('/devices/:deviceId', cryptoController.removeDevice);
router.get('/conversations/:conversationId/recipients', cryptoController.getConversationRecipients);
router.get('/users/:userId/recipients', cryptoController.getUserRecipients);

module.exports = router;
