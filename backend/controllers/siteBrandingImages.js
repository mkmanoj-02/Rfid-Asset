const fs = require('fs').promises;
const {
  publicUrlForStoredFile,
  diskPathFromImageUrl,
  ENTITY_UPLOAD_SUBDIR,
} = require('../helper/upload');
const { truthyFormFlag } = require('./imageInheritance');

const BRANDING_SUBDIR = ENTITY_UPLOAD_SUBDIR.site_branding;

async function safeUnlinkBrandingFile(imageUrl) {
  const diskPath = diskPathFromImageUrl(imageUrl);
  if (!diskPath) return;
  try {
    await fs.unlink(diskPath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

/** @deprecated use safeUnlinkBrandingFile */
const safeUnlinkBrandingLogo = safeUnlinkBrandingFile;

function logoUrlFromUpload(file) {
  if (!file) return null;
  return publicUrlForStoredFile(BRANDING_SUBDIR, file.filename);
}

async function resolveBrandingFileOnUpdate(previousUrl, file, removeFlag) {
  if (removeFlag) {
    if (previousUrl) await safeUnlinkBrandingFile(previousUrl);
    return null;
  }
  if (file) {
    if (previousUrl) await safeUnlinkBrandingFile(previousUrl);
    return publicUrlForStoredFile(BRANDING_SUBDIR, file.filename);
  }
  return previousUrl || null;
}

async function resolveBrandingLogoOnUpdate(previousUrl, file, removeLogo) {
  return resolveBrandingFileOnUpdate(previousUrl, file, removeLogo);
}

function firstUploadedFile(req, fieldName) {
  const list = req.files?.[fieldName];
  return Array.isArray(list) && list[0] ? list[0] : null;
}

module.exports = {
  safeUnlinkBrandingLogo,
  safeUnlinkBrandingFile,
  logoUrlFromUpload,
  resolveBrandingLogoOnUpdate,
  resolveBrandingFileOnUpdate,
  firstUploadedFile,
  truthyFormFlag,
  BRANDING_SUBDIR,
};
