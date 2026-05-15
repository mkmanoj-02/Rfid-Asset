/**
 * Enterprise image upload configuration (multer).
 * Physical layout: backend/uploads/{assets|locations|asset-types}/
 * Public URLs: /uploads/{subdir}/{filename} (served by express.static in index.js)
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs');

/** Absolute path to backend/uploads */
const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');

/** URL prefix stored in image_url and used by clients */
const PUBLIC_UPLOAD_PREFIX = '/uploads';

/** Max upload size (5 MB) */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** API / DB entity key → folder name under uploads/ */
const ENTITY_UPLOAD_SUBDIR = {
  assets: 'assets',
  locations: 'locations',
  asset_types: 'asset-types',
};

/** Allowed extensions and acceptable MIME types */
const EXT_TO_MIMES = {
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.webp': ['image/webp'],
};

function allowedExtensionsList() {
  return Object.keys(EXT_TO_MIMES).join(', ');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * Multer disk storage: dynamic destination per entity, unique filename (timestamp + random).
 * @param {string} subdir folder under UPLOAD_ROOT (e.g. 'assets')
 */
function createStorage(subdir) {
  const absoluteDest = path.join(UPLOAD_ROOT, subdir);
  return multer.diskStorage({
    destination(req, file, cb) {
      try {
        ensureDir(absoluteDest);
        cb(null, absoluteDest);
      } catch (e) {
        cb(e);
      }
    },
    filename(req, file, cb) {
      const ext = path.extname(file.originalname || '').toLowerCase();
      cb(null, `${Date.now()}-${Math.floor(Math.random() * 1e9)}${ext}`);
    },
  });
}

function validateImageFile(req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!ext || !EXT_TO_MIMES[ext]) {
    return cb(
      new Error(`Invalid file type. Allowed image types: ${allowedExtensionsList()}`)
    );
  }
  const allowedMimes = EXT_TO_MIMES[ext];
  if (!allowedMimes.includes(file.mimetype)) {
    return cb(
      new Error(
        `Invalid MIME type "${file.mimetype}" for ${ext}. Allowed: ${allowedExtensionsList()}`
      )
    );
  }
  cb(null, true);
}

/**
 * Express middleware: multipart field name `image`, writes to uploads/{entityFolder}/.
 * @param {'assets'|'locations'|'asset_types'} entityKey
 */
function uploadImageMiddleware(entityKey) {
  const subdir = ENTITY_UPLOAD_SUBDIR[entityKey];
  if (!subdir) {
    throw new Error(`uploadImageMiddleware: unknown entity "${entityKey}"`);
  }
  const storage = createStorage(subdir);
  return multer({
    storage,
    limits: { fileSize: MAX_FILE_BYTES },
    fileFilter: validateImageFile,
  }).single('image');
}

/**
 * Error handler placed after multer middleware.
 * Maps multer / validation errors to 400 JSON responses.
 */
function handleMulterImageError(err, req, res, next) {
  if (!err) return next();

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'File too large. Maximum size is 5MB.' });
    }
    return res.status(400).json({ message: err.message || 'Upload failed.' });
  }

  if (err.message && err.message.startsWith('Invalid file type')) {
    return res.status(400).json({ message: err.message });
  }
  if (err.message && err.message.startsWith('Invalid MIME type')) {
    return res.status(400).json({ message: err.message });
  }

  return next(err);
}

/** Public URL saved in image_url */
function publicUrlForStoredFile(subdir, filename) {
  return `${PUBLIC_UPLOAD_PREFIX}/${subdir}/${filename}`;
}

/**
 * Resolve absolute disk path from DB image_url (/uploads/...).
 * Returns null if value is missing or unsafe.
 */
function diskPathFromImageUrl(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string') return null;
  const trimmed = imageUrl.trim();
  const prefix = `${PUBLIC_UPLOAD_PREFIX}/`;
  if (!trimmed.startsWith(prefix)) return null;
  const rel = trimmed.slice(prefix.length).replace(/\\/g, '/');
  if (!rel || rel.includes('..')) return null;
  const segments = rel.split('/').filter(Boolean);
  const full = path.resolve(path.join(UPLOAD_ROOT, ...segments));
  const rootResolved = path.resolve(UPLOAD_ROOT);
  const sep = path.sep;
  if (full !== rootResolved && !full.startsWith(rootResolved + sep)) return null;
  return full;
}

module.exports = {
  uploadImageMiddleware,
  handleMulterImageError,
  publicUrlForStoredFile,
  diskPathFromImageUrl,
  UPLOAD_ROOT,
  PUBLIC_UPLOAD_PREFIX,
  ENTITY_UPLOAD_SUBDIR,
  MAX_FILE_BYTES,
};
