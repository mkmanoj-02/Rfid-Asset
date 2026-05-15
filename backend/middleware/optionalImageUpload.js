/**
 * Runs multer only when Content-Type is multipart/form-data (keeps JSON APIs working).
 */

const { uploadImageMiddleware, handleMulterImageError } = require('../helper/upload');
const { isMultipartRequest } = require('../controllers/imageInheritance');

/**
 * @param {'assets'|'locations'|'asset_types'} entityKey
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

module.exports = { optionalImageUpload };
