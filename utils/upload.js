const multer = require('multer');
const path = require('path');
const { TMP_DIR } = require('../settings/paths');

// ======================== MULTER ========================
// Instancia única reusada por las rutas de referencias y de metrología
// (moldes), igual que antes.
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TMP_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'tmp-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'application/pdf'];
    cb(null, allowed.includes(file.mimetype));
  }
});

module.exports = { upload };
