/**
 * Role / profile_type guard. Use after verifyToken.
 *
 * @example
 * router.get('/admin-only', verifyToken, authorizeRoles('super_admin'), handler);
 * router.get('/staff', verifyToken, authorizeRoles('super_admin', 'admin'), handler);
 */
function authorizeRoles(...allowedRoles) {
  const allowed = new Set(allowedRoles);

  return function roleGuard(req, res, next) {
    if (!req.user) {
      return res.status(401).json({
        status: false,
        message: 'Authentication required',
      });
    }

    if (!allowed.has(req.user.profile_type)) {
      return res.status(403).json({
        status: false,
        message: 'Insufficient permissions for this resource',
      });
    }

    return next();
  };
}

module.exports = authorizeRoles;
