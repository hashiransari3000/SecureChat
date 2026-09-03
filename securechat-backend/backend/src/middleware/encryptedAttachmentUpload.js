const multer = require('multer');

module.exports = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    // The browser encrypts bytes before upload, so the server intentionally
    // receives only opaque application/octet-stream data.
    if (file.mimetype !== 'application/octet-stream') return cb(Object.assign(new Error('ENCRYPTED_ATTACHMENT_REQUIRED'), { statusCode: 415 }));
    cb(null, true);
  },
});
