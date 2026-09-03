const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const dataController = require('../controllers/dataController');

router.use(requireAuth);
router.post('/export', dataController.exportData);
router.delete('/account', dataController.deleteAccount);

module.exports = router;
