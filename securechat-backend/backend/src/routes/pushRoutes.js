const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const pushController = require('../controllers/pushController');

router.use(requireAuth);

router.post('/token', pushController.registerToken);
router.delete('/token', pushController.unregisterToken);

module.exports = router;