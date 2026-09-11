const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const pushController = require('../controllers/pushController');

router.get('/debug', (req, res) => {
  const { stage, msg } = req.query;
  console.log(`[push-debug] ${stage}: ${msg || ''}`);
  res.status(204).end();
});

router.use(requireAuth);

router.post('/token', pushController.registerToken);
router.delete('/token', pushController.unregisterToken);

module.exports = router;