/**
 * Sync JWT user onto legacy audit / header-style fields used by existing routes.
 * Optional: use globally after optional auth, or after verifyToken on protected routes.
 */
function attachUserContext(req, res, next) {
  if (req.user) {
    req.auditUserId = req.user.id;
    req.auditUser = req.user.username;
  }
  next();
}

module.exports = attachUserContext;
