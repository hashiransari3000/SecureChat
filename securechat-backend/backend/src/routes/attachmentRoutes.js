const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const upload = require('../middleware/encryptedAttachmentUpload');
const attachmentController = require('../controllers/attachmentController');

router.use(requireAuth);
router.post('/', upload.single('encryptedFile'), attachmentController.uploadEncrypted);
router.get('/:attachmentId', attachmentController.downloadEncrypted);

module.exports = router;
