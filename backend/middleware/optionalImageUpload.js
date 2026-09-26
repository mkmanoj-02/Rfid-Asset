/**
 * Runs multer only when Content-Type is multipart/form-data (keeps JSON APIs working).
 */

const {
  uploadImageMiddleware,
  uploadBrandingFieldsMiddleware,
  handleMulterImageError,
} = require('../helper/upload');
const { isMultipartRequest } = require('../controllers/imageInheritance');

/**
 * @param {'assets'|'locations'|'asset_types'|'site_branding'|'dashboard_image'} entityKey
 */
function optionalImageUpload(entityKey) {
  const multerMw = uploadImageMiddleware(entityKey);
  return (req, res, next) => {
    if (!isMultipartRequest(req)) return next();
    multerMw(req, res, (err) => {
      if (err) return handleMulterImageError(err, req, res, next);
      next();
    });
  };
}

/** Logo (`image`) + favicon (`favicon`) for site branding PUT */
function optionalBrandingUpload() {
  const multerMw = uploadBrandingFieldsMiddleware('site_branding');
  return (req, res, next) => {
    if (!isMultipartRequest(req)) return next();
    multerMw(req, res, (err) => {
      if (err) return handleMulterImageError(err, req, res, next);
      next();
    });
  };
}

module.exports = { optionalImageUpload, optionalBrandingUpload };
