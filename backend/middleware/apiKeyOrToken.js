const crypto = require('crypto');
const verifyToken = require('./verifyToken');

const API_KEY_HEADER = 'x-auth-token';

function configuredKeys() {
  return (process.env.RFID_API_KEYS || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

function keyMatches(given, expected) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * RFID middleware auth: a valid X-Auth-Token header (one of RFID_API_KEYS) grants access
 * without a login. Requests without the header fall back to the normal Bearer JWT check,
 * so the web app keeps working on the same endpoints.
 * - 401: X-Auth-Token sent but not recognised
 */
function apiKeyOrToken(req, res, next) {
  const given = req.headers[API_KEY_HEADER];
  if (given === undefined) return verifyToken(req, res, next);

  const token = String(given).trim();
  if (token && configuredKeys().some((k) => keyMatches(token, k))) {
    req.apiClient = 'rfid-middleware';
    req.auditUser = 'RFID Middleware';
    req.auditUserId = null;
    return next();
  }
  return res.status(401).json({ status: false, message: 'Invalid X-Auth-Token', data: null });
}

module.exports = apiKeyOrToken;
