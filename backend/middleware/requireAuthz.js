const {
  canModify,
  canDelete,
  canManageUsers,
  deny,
} = require('../lib/userAuthz');

function requireAuthzLoaded(req, res) {
  if (!req.authz) return deny(res, 'Authentication required', 401);
  return null;
}

/** Require asset|location|asset_type|location_type modify permission. */
function requireModify(resource) {
  return (req, res, next) => {
    const err = requireAuthzLoaded(req, res);
    if (err) return err;
    if (!canModify(req.authz, resource)) {
      return deny(res, `You do not have permission to modify ${resource.replace(/_/g, ' ')}s`);
    }
    return next();
  };
}

/** Require asset|location|asset_type|location_type delete permission. */
function requireDelete(resource) {
  return (req, res, next) => {
    const err = requireAuthzLoaded(req, res);
    if (err) return err;
    if (!canDelete(req.authz, resource)) {
      return deny(res, `You do not have permission to delete ${resource.replace(/_/g, ' ')}s`);
    }
    return next();
  };
}

/** User management: super_admin or admin profile only. */
function requireUserAdmin(req, res, next) {
  const err = requireAuthzLoaded(req, res);
  if (err) return err;
  if (!canManageUsers(req.authz)) {
    return deny(res, 'You do not have permission to manage users');
  }
  return next();
}

module.exports = {
  requireModify,
  requireDelete,
  requireUserAdmin,
};
