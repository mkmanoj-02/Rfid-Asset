/**
 * Asset / asset-type image inheritance and filesystem helpers.
 * Inherited assets store the same image_url as their type (under uploads/asset-types/).
 * Custom assets store files under uploads/assets/ with is_custom_image = 1.
 */

const fs = require('fs').promises;
const db = require('../db');
const {
  publicUrlForStoredFile,
  diskPathFromImageUrl,
  ENTITY_UPLOAD_SUBDIR,
} = require('../helper/upload');

const ASSET_TYPE_SUBDIR = ENTITY_UPLOAD_SUBDIR.asset_types;
const ASSET_SUBDIR = ENTITY_UPLOAD_SUBDIR.assets;

/** Delete file on disk when image_url points to a safe path under uploads/. */
async function safeUnlinkImageUrl(imageUrl) {
  const diskPath = diskPathFromImageUrl(imageUrl);
  if (!diskPath) return;
  try {
    await fs.unlink(diskPath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

/** Only remove files stored under uploads/assets/ (custom asset images). */
async function safeUnlinkCustomAssetFile(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string') return;
  const prefix = `/uploads/${ASSET_SUBDIR}/`;
  if (!imageUrl.startsWith(prefix)) return;
  await safeUnlinkImageUrl(imageUrl);
}

async function getAssetTypeImageUrl(assetTypeId) {
  if (!assetTypeId) return null;
  const [rows] = await db.query('SELECT image_url FROM asset_types WHERE id = ?', [assetTypeId]);
  return rows[0]?.image_url || null;
}

/**
 * After asset type image_url changes, sync all non-custom assets of that type.
 */
async function propagateTypeImageToInheritedAssets(assetTypeId, imageUrl) {
  await db.query(
    `UPDATE assets SET image_url = ? WHERE asset_type_id = ? AND is_custom_image = 0`,
    [imageUrl, assetTypeId]
  );
}

/**
 * Build image_url + is_custom_image for new asset from optional multer file + type id.
 */
async function resolveAssetImageOnCreate(assetTypeId, uploadedFile) {
  if (uploadedFile) {
    return {
      imageUrl: publicUrlForStoredFile(ASSET_SUBDIR, uploadedFile.filename),
      isCustom: 1,
    };
  }
  const typeUrl = await getAssetTypeImageUrl(assetTypeId);
  return {
    imageUrl: typeUrl,
    isCustom: 0,
  };
}

/**
 * Apply image changes on asset update (multipart).
 * @param {object} opts
 * @param {object} opts.existing - row with image_url, is_custom_image, asset_type_id
 * @param {object|null} opts.file - multer file
 * @param {boolean} opts.removeCustomImage - user cleared custom image
 * @param {number|string} opts.newAssetTypeId - asset type after update
 */
async function resolveAssetImageOnUpdate({ existing, file, removeCustomImage, newAssetTypeId }) {
  const typeId = newAssetTypeId ?? existing.asset_type_id;
  const wasCustom = Number(existing.is_custom_image) === 1;

  // New custom upload
  if (file) {
    if (wasCustom && existing.image_url) {
      await safeUnlinkCustomAssetFile(existing.image_url);
    }
    return {
      imageUrl: publicUrlForStoredFile(ASSET_SUBDIR, file.filename),
      isCustom: 1,
    };
  }

  // Explicit revert to inherited type image
  if (removeCustomImage) {
    if (wasCustom && existing.image_url) {
      await safeUnlinkCustomAssetFile(existing.image_url);
    }
    const typeUrl = await getAssetTypeImageUrl(typeId);
    return { imageUrl: typeUrl, isCustom: 0 };
  }

  // Type changed while still inherited → pick up new type image
  if (!wasCustom && typeId !== existing.asset_type_id) {
    const typeUrl = await getAssetTypeImageUrl(typeId);
    return { imageUrl: typeUrl, isCustom: 0 };
  }

  return {
    imageUrl: existing.image_url,
    isCustom: Number(existing.is_custom_image) || 0,
  };
}

/**
 * Save asset type image from multer file; delete previous type image file; propagate to inherited assets.
 */
async function applyAssetTypeImageUpdate(typeId, previousImageUrl, file) {
  if (!file) return previousImageUrl;

  if (previousImageUrl) {
    await safeUnlinkImageUrl(previousImageUrl);
  }

  const imageUrl = publicUrlForStoredFile(ASSET_TYPE_SUBDIR, file.filename);
  await db.query('UPDATE asset_types SET image_url = ? WHERE id = ?', [imageUrl, typeId]);
  await propagateTypeImageToInheritedAssets(typeId, imageUrl);
  return imageUrl;
}

/**
 * DELETE /assets/:id/image — revert to inherited type image (never delete type file).
 */
async function revertAssetToInheritedImage(assetId) {
  const [rows] = await db.query(
    'SELECT id, image_url, is_custom_image, asset_type_id FROM assets WHERE id = ?',
    [assetId]
  );
  if (!rows.length) return { ok: false, status: 404, message: 'Not found' };

  const row = rows[0];
  if (Number(row.is_custom_image) === 1 && row.image_url) {
    await safeUnlinkCustomAssetFile(row.image_url);
  }

  const typeUrl = await getAssetTypeImageUrl(row.asset_type_id);
  await db.query('UPDATE assets SET image_url = ?, is_custom_image = 0 WHERE id = ?', [typeUrl, assetId]);

  return {
    ok: true,
    image_url: typeUrl,
    is_custom_image: 0,
    message: 'Reverted to inherited asset type image',
  };
}

/**
 * On asset delete: remove custom image file only.
 */
async function cleanupAssetImageOnDelete(assetRow) {
  if (Number(assetRow.is_custom_image) === 1 && assetRow.image_url) {
    await safeUnlinkCustomAssetFile(assetRow.image_url);
  }
}

/**
 * On asset type delete: remove type image file (caller should block if assets exist).
 */
async function cleanupAssetTypeImageOnDelete(typeRow) {
  if (typeRow.image_url) {
    await safeUnlinkImageUrl(typeRow.image_url);
  }
}

function isMultipartRequest(req) {
  return (req.headers['content-type'] || '').includes('multipart/form-data');
}

/** Parse attributes JSON string from multipart body (optional). */
function parseAttributesField(body) {
  const raw = body?.attributes;
  if (raw === undefined || raw === null || raw === '') return null;
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function truthyFormFlag(val) {
  if (val === undefined || val === null || val === '') return false;
  const s = String(val).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

module.exports = {
  safeUnlinkImageUrl,
  safeUnlinkCustomAssetFile,
  getAssetTypeImageUrl,
  propagateTypeImageToInheritedAssets,
  resolveAssetImageOnCreate,
  resolveAssetImageOnUpdate,
  applyAssetTypeImageUpdate,
  revertAssetToInheritedImage,
  cleanupAssetImageOnDelete,
  cleanupAssetTypeImageOnDelete,
  isMultipartRequest,
  parseAttributesField,
  truthyFormFlag,
  ASSET_TYPE_SUBDIR,
  ASSET_SUBDIR,
};
