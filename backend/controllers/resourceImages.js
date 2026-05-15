/**
 * Reusable image upload / delete for assets, locations, and asset_types.
 * Uses helper/upload.js for multer and path helpers.
 */

const fs = require('fs').promises;
const db = require('../db');
const audit = require('../audit');
const {
  publicUrlForStoredFile,
  diskPathFromImageUrl,
  ENTITY_UPLOAD_SUBDIR,
} = require('../helper/upload');

/** entityKey → SQL table + audit type label */
const ENTITY_CONFIG = {
  assets: { table: 'assets', auditType: 'Asset' },
  locations: { table: 'locations', auditType: 'Location' },
  asset_types: { table: 'asset_types', auditType: 'Asset Type' },
};

async function safeUnlinkFile(imageUrl) {
  const diskPath = diskPathFromImageUrl(imageUrl);
  if (!diskPath) return;
  try {
    await fs.unlink(diskPath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

function parseResourceId(req) {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return { ok: false, status: 400, message: 'Invalid ID' };
  return { ok: true, id };
}

/**
 * POST handler: replace image on disk + update image_url.
 * Expects multer to have populated req.file.
 */
function upload(entityKey) {
  return async (req, res, next) => {
    const cfg = ENTITY_CONFIG[entityKey];
    const subdir = ENTITY_UPLOAD_SUBDIR[entityKey];
    if (!cfg || !subdir) {
      return res.status(500).json({ message: 'Server configuration error' });
    }

    const parsed = parseResourceId(req);
    if (!parsed.ok) {
      return res.status(parsed.status).json({ message: parsed.message });
    }
    const { id } = parsed;

    if (!req.file) {
      return res.status(400).json({
        message: 'No image file provided. Send multipart/form-data with field name "image".',
      });
    }

    try {
      const [rows] = await db.query(`SELECT id, image_url FROM ${cfg.table} WHERE id = ?`, [id]);
      if (!rows.length) {
        try {
          await fs.unlink(req.file.path);
        } catch {}
        return res.status(404).json({ message: 'Not found' });
      }

      const previousUrl = rows[0].image_url;
      if (previousUrl) await safeUnlinkFile(previousUrl);

      const imageUrl = publicUrlForStoredFile(subdir, req.file.filename);
      await db.query(`UPDATE ${cfg.table} SET image_url = ? WHERE id = ?`, [imageUrl, id]);

      await audit.log(
        cfg.auditType,
        'Image uploaded',
        `${cfg.auditType} ID ${id}: image set to ${imageUrl}`,
        req.auditUser,
        req.auditUserId
      );

      return res.status(200).json({ image_url: imageUrl, message: 'Image uploaded successfully' });
    } catch (err) {
      try {
        if (req.file?.path) await fs.unlink(req.file.path);
      } catch {}
      return next(err);
    }
  };
}

/**
 * DELETE handler: remove file from disk + set image_url NULL.
 */
function remove(entityKey) {
  return async (req, res, next) => {
    const cfg = ENTITY_CONFIG[entityKey];
    if (!cfg) {
      return res.status(500).json({ message: 'Server configuration error' });
    }

    const parsed = parseResourceId(req);
    if (!parsed.ok) {
      return res.status(parsed.status).json({ message: parsed.message });
    }
    const { id } = parsed;

    try {
      const [rows] = await db.query(`SELECT id, image_url FROM ${cfg.table} WHERE id = ?`, [id]);
      if (!rows.length) return res.status(404).json({ message: 'Not found' });

      const previousUrl = rows[0].image_url;
      if (previousUrl) await safeUnlinkFile(previousUrl);

      await db.query(`UPDATE ${cfg.table} SET image_url = NULL WHERE id = ?`, [id]);

      await audit.log(
        cfg.auditType,
        'Image deleted',
        `${cfg.auditType} ID ${id}: image removed`,
        req.auditUser,
        req.auditUserId
      );

      return res.json({ image_url: null, message: 'Image deleted successfully' });
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = {
  upload,
  remove,
};
