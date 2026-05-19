const fs = require('fs').promises;
const {
  publicUrlForStoredFile,
  diskPathFromImageUrl,
  ENTITY_UPLOAD_SUBDIR,
} = require('../helper/upload');
const { truthyFormFlag } = require('./imageInheritance');

const BRANDING_SUBDIR = ENTITY_UPLOAD_SUBDIR.site_branding;

async function safeUnlinkBrandingLogo(logoUrl) {
  const diskPath = diskPathFromImageUrl(logoUrl);
  if (!diskPath) return;
  try {
    await fs.unlink(diskPath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

function logoUrlFromUpload(file) {
  if (!file) return null;
  return publicUrlForStoredFile(BRANDING_SUBDIR, file.filename);
}

async function resolveBrandingLogoOnUpdate(previousUrl, file, removeLogo) {
  if (removeLogo) {
    if (previousUrl) await safeUnlinkBrandingLogo(previousUrl);
    return null;
  }
  if (file) {
    if (previousUrl) await safeUnlinkBrandingLogo(previousUrl);
    return publicUrlForStoredFile(BRANDING_SUBDIR, file.filename);
  }
  return previousUrl || null;
}

module.exports = {
  safeUnlinkBrandingLogo,
  logoUrlFromUpload,
  resolveBrandingLogoOnUpdate,
  truthyFormFlag,
  BRANDING_SUBDIR,
};
