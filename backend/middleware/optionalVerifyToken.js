const { verifyAccessToken } = require('../helpers/jwt');

/**
 * If Authorization Bearer token is present and valid, sets req.user.
 * Does not reject requests without a token (for gradual migration with x-user-id).
 */
function optionalVerifyToken(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return next();

  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1]) return next();

  try {
    const decoded = verifyAccessToken(parts[1]);
    req.user = {
      id: decoded.id,
      username: decoded.username,
      profile_type: decoded.profile_type,
    };
  } catch {
    // Invalid token on optional path — ignore; protected routes use verifyToken
  }
  return next();
}

module.exports = optionalVerifyToken;
