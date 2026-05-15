/**
 * Dedicated POST /:id/image endpoints (optional; create/update also accept multipart).
 * Asset delete image reverts to inheritance; asset type delete removes type file.
 */

const fs = require('fs').promises;
const db = require('../db');
const audit = require('../audit');
const {
  publicUrlForStoredFile,
  ENTITY_UPLOAD_SUBDIR,
} = require('../helper/upload');
const {
  safeUnlinkImageUrl,
  safeUnlinkCustomAssetFile,
  applyAssetTypeImageUpdate,
  propagateTypeImageToInheritedAssets,
  revertAssetToInheritedImage,
} = require('./imageInheritance');

const ENTITY_CONFIG = {
  assets: { table: 'assets', auditType: 'Asset', subdir: ENTITY_UPLOAD_SUBDIR.assets },
  locations: { table: 'locations', auditType: 'Location', subdir: ENTITY_UPLOAD_SUBDIR.locations },
  asset_types: { table: 'asset_types', auditType: 'Asset Type', subdir: ENTITY_UPLOAD_SUBDIR.asset_types },
};

function parseResourceId(req) {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return { ok: false, status: 400, message: 'Invalid ID' };
  return { ok: true, id };
}

/** POST /:id/image — upload or replace image on existing record. */
function upload(entityKey) {
  return async (req, res, next) => {
    const cfg = ENTITY_CONFIG[entityKey];
    if (!cfg) return res.status(500).json({ message: 'Server configuration error' });

    const parsed = parseResourceId(req);
    if (!parsed.ok) return res.status(parsed.status).json({ message: parsed.message });
    const { id } = parsed;

    if (!req.file) {
      return res.status(400).json({
        message: 'No image file provided. Send multipart/form-data with field name "image".',
      });
    }

    try {
      if (entityKey === 'assets') {
        const [rows] = await db.query(
          'SELECT id, image_url, is_custom_image FROM assets WHERE id = ?',
          [id]
        );
        if (!rows.length) {
          try { await fs.unlink(req.file.path); } catch {}
          return res.status(404).json({ message: 'Not found' });
        }
        if (Number(rows[0].is_custom_image) === 1 && rows[0].image_url) {
          await safeUnlinkCustomAssetFile(rows[0].image_url);
        }
        const imageUrl = publicUrlForStoredFile(cfg.subdir, req.file.filename);
        await db.query(
          'UPDATE assets SET image_url = ?, is_custom_image = 1 WHERE id = ?',
          [imageUrl, id]
        );
        await audit.log(cfg.auditType, 'Image uploaded', `Asset ID ${id}: custom image ${imageUrl}`, req.auditUser, req.auditUserId);
        return res.status(200).json({
          image_url: imageUrl,
          is_custom_image: 1,
          message: 'Image uploaded successfully',
        });
      }

      if (entityKey === 'asset_types') {
        const [rows] = await db.query('SELECT id, image_url FROM asset_types WHERE id = ?', [id]);
        if (!rows.length) {
          try { await fs.unlink(req.file.path); } catch {}
          return res.status(404).json({ message: 'Not found' });
        }
        const imageUrl = await applyAssetTypeImageUpdate(id, rows[0].image_url, req.file);
        await audit.log(cfg.auditType, 'Image uploaded', `Asset type ID ${id}: image ${imageUrl}`, req.auditUser, req.auditUserId);
        return res.status(200).json({ image_url: imageUrl, message: 'Image uploaded successfully' });
      }

      // locations — simple replace
      const [rows] = await db.query(`SELECT id, image_url FROM ${cfg.table} WHERE id = ?`, [id]);
      if (!rows.length) {
        try { await fs.unlink(req.file.path); } catch {}
        return res.status(404).json({ message: 'Not found' });
      }
      if (rows[0].image_url) await safeUnlinkImageUrl(rows[0].image_url);
      const imageUrl = publicUrlForStoredFile(cfg.subdir, req.file.filename);
      await db.query(`UPDATE ${cfg.table} SET image_url = ? WHERE id = ?`, [imageUrl, id]);
      await audit.log(cfg.auditType, 'Image uploaded', `${cfg.auditType} ID ${id}: image ${imageUrl}`, req.auditUser, req.auditUserId);
      return res.status(200).json({ image_url: imageUrl, message: 'Image uploaded successfully' });
    } catch (err) {
      try { if (req.file?.path) await fs.unlink(req.file.path); } catch {}
      return next(err);
    }
  };
}

/** DELETE /:id/image */
function remove(entityKey) {
  return async (req, res, next) => {
    const cfg = ENTITY_CONFIG[entityKey];
    if (!cfg) return res.status(500).json({ message: 'Server configuration error' });

    const parsed = parseResourceId(req);
    if (!parsed.ok) return res.status(parsed.status).json({ message: parsed.message });
    const { id } = parsed;

    try {
      if (entityKey === 'assets') {
        const result = await revertAssetToInheritedImage(id);
        if (!result.ok) return res.status(result.status).json({ message: result.message });
        await audit.log(cfg.auditType, 'Image reverted', `Asset ID ${id}: reverted to inherited image`, req.auditUser, req.auditUserId);
        return res.json(result);
      }

      if (entityKey === 'asset_types') {
        const [rows] = await db.query('SELECT id, image_url FROM asset_types WHERE id = ?', [id]);
        if (!rows.length) return res.status(404).json({ message: 'Not found' });
        if (rows[0].image_url) await safeUnlinkImageUrl(rows[0].image_url);
        await db.query('UPDATE asset_types SET image_url = NULL WHERE id = ?', [id]);
        await propagateTypeImageToInheritedAssets(id, null);
        await audit.log(cfg.auditType, 'Image deleted', `Asset type ID ${id}: image removed`, req.auditUser, req.auditUserId);
        return res.json({ image_url: null, message: 'Image deleted successfully' });
      }

      const [rows] = await db.query(`SELECT id, image_url FROM ${cfg.table} WHERE id = ?`, [id]);
      if (!rows.length) return res.status(404).json({ message: 'Not found' });
      if (rows[0].image_url) await safeUnlinkImageUrl(rows[0].image_url);
      await db.query(`UPDATE ${cfg.table} SET image_url = NULL WHERE id = ?`, [id]);
      await audit.log(cfg.auditType, 'Image deleted', `${cfg.auditType} ID ${id}: image removed`, req.auditUser, req.auditUserId);
      return res.json({ image_url: null, message: 'Image deleted successfully' });
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { upload, remove };
