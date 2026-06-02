const fs = require('fs').promises;
const {
  publicUrlForStoredFile,
  diskPathFromImageUrl,
  ENTITY_UPLOAD_SUBDIR,
} = require('../helper/upload');

const DASHBOARD_IMAGE_SUBDIR = ENTITY_UPLOAD_SUBDIR.dashboard_image;

async function safeUnlinkDashboardImage(imageUrl) {
  const diskPath = diskPathFromImageUrl(imageUrl);
  if (!diskPath) return;
  try {
    await fs.unlink(diskPath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

function dashboardImageUrlFromUpload(file) {
  if (!file) return null;
  return publicUrlForStoredFile(DASHBOARD_IMAGE_SUBDIR, file.filename);
}

/**
 * @param {string|null} previousUrl
 * @param {Express.Multer.File|null} file
 * @param {boolean} removeImage
 */
async function resolveDashboardImageOnUpdate(previousUrl, file, removeImage) {
  if (removeImage) {
    if (previousUrl) await safeUnlinkDashboardImage(previousUrl);
    return null;
  }
  if (file) {
    if (previousUrl) await safeUnlinkDashboardImage(previousUrl);
    return dashboardImageUrlFromUpload(file);
  }
  return previousUrl || null;
}

module.exports = {
  safeUnlinkDashboardImage,
  dashboardImageUrlFromUpload,
  resolveDashboardImageOnUpdate,
  DASHBOARD_IMAGE_SUBDIR,
};
