/**
 * Location image helpers — create / update / delete with filesystem cleanup.
 */

const fs = require('fs').promises;
const {
  publicUrlForStoredFile,
  diskPathFromImageUrl,
  ENTITY_UPLOAD_SUBDIR,
} = require('../helper/upload');
const { truthyFormFlag } = require('./imageInheritance');

const LOCATION_SUBDIR = ENTITY_UPLOAD_SUBDIR.locations;

async function safeUnlinkLocationImage(imageUrl) {
  const diskPath = diskPathFromImageUrl(imageUrl);
  if (!diskPath) return;
  try {
    await fs.unlink(diskPath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

/** Resolve image_url for new location from optional multer file. */
function imageUrlFromUpload(file) {
  if (!file) return null;
  return publicUrlForStoredFile(LOCATION_SUBDIR, file.filename);
}

/**
 * Apply image on location update.
 * @returns {Promise<string|null>} final image_url
 */
async function resolveLocationImageOnUpdate(previousUrl, file, removeImage) {
  if (removeImage) {
    if (previousUrl) await safeUnlinkLocationImage(previousUrl);
    return null;
  }
  if (file) {
    if (previousUrl) await safeUnlinkLocationImage(previousUrl);
    return publicUrlForStoredFile(LOCATION_SUBDIR, file.filename);
  }
  return previousUrl || null;
}

async function cleanupLocationImageOnDelete(locationRow) {
  if (locationRow?.image_url) {
    await safeUnlinkLocationImage(locationRow.image_url);
  }
}

module.exports = {
  safeUnlinkLocationImage,
  imageUrlFromUpload,
  resolveLocationImageOnUpdate,
  cleanupLocationImageOnDelete,
  truthyFormFlag,
  LOCATION_SUBDIR,
};
