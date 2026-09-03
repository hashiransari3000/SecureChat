const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const privacyController = require('../controllers/privacyController');

router.use(requireAuth);
router.get('/', privacyController.getSettings);
router.patch('/', privacyController.updateSetting);

module.exports = router;
