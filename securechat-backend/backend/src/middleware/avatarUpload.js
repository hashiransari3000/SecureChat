const multer = require('multer');

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) return cb(null, true);
    const error = new Error('UNSUPPORTED_AVATAR_TYPE');
    error.statusCode = 415;
    cb(error);
  },
});

module.exports = avatarUpload;
