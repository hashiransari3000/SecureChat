const express = require('express');
const { getLatest, setVersion } = require('../controllers/appController');

const router = express.Router();

router.get('/latest', getLatest);
router.post('/version', setVersion);

module.exports = router;