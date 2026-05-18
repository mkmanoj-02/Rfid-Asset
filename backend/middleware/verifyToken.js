const db = require('../db');
const { verifyAccessToken } = require('../helpers/jwt');

/**
 * Extract Bearer token from Authorization header.
 */
function extractBearerToken(req) {
  const header = req.headers.authorization;
  if (!header) return null;
  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;
  return parts[1];
}

/**
 * Verify JWT access token and attach decoded user to req.user.
 * - 401: missing token
 * - 403: invalid or expired token
 */
async function verifyToken(req, res, next) {
  const token = extractBearerToken(req);

  if (!token) {
    return res.status(401).json({
      status: false,
      message: 'Access token required. Use Authorization: Bearer <token>',
    });
  }

  try {
    const decoded = verifyAccessToken(token);
    const [rows] = await db.query('SELECT id FROM users WHERE id = ? LIMIT 1', [decoded.id]);
    if (!rows.length) {
      return res.status(403).json({
        status: false,
        message: 'User account no longer exists',
        code: 'USER_NOT_FOUND',
      });
    }
    req.user = {
      id: decoded.id,
      username: decoded.username,
      profile_type: decoded.profile_type,
    };
    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(403).json({
        status: false,
        message: 'Access token expired',
        code: 'TOKEN_EXPIRED',
      });
    }
    if (err.name === 'JsonWebTokenError' || err.name === 'NotBeforeError') {
      return res.status(403).json({
        status: false,
        message: 'Invalid access token',
        code: 'TOKEN_INVALID',
      });
    }
    return next(err);
  }
}

module.exports = verifyToken;
