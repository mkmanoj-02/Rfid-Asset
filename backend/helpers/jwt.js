const jwt = require('jsonwebtoken');
const authConfig = require('../config/auth.config');

function assertSecrets() {
  if (!authConfig.accessTokenSecret || !authConfig.refreshTokenSecret) {
    throw new Error(
      'ACCESS_TOKEN_SECRET and REFRESH_TOKEN_SECRET must be set in environment variables'
    );
  }
}

/**
 * Build access-token payload from user row.
 * @param {{ id: number, username: string, profile_type: string }} user
 */
function buildAccessPayload(user) {
  return {
    id: user.id,
    username: user.username,
    profile_type: user.profile_type,
  };
}

/**
 * Generate short-lived access JWT.
 */
function generateAccessToken(user) {
  assertSecrets();
  return jwt.sign(buildAccessPayload(user), authConfig.accessTokenSecret, {
    expiresIn: authConfig.accessTokenExpiresIn,
  });
}

/**
 * Generate long-lived refresh JWT.
 */
function generateRefreshToken(user) {
  assertSecrets();
  return jwt.sign(
    { id: user.id, tokenType: 'refresh' },
    authConfig.refreshTokenSecret,
    { expiresIn: authConfig.refreshTokenExpiresIn }
  );
}

/**
 * Verify access token; throws jwt.JsonWebTokenError / TokenExpiredError on failure.
 */
function verifyAccessToken(token) {
  assertSecrets();
  return jwt.verify(token, authConfig.accessTokenSecret);
}

/**
 * Verify refresh token; throws on failure.
 */
function verifyRefreshToken(token) {
  assertSecrets();
  const decoded = jwt.verify(token, authConfig.refreshTokenSecret);
  if (decoded.tokenType !== 'refresh') {
    const err = new Error('Invalid refresh token type');
    err.name = 'JsonWebTokenError';
    throw err;
  }
  return decoded;
}

/**
 * Decode refresh token expiry as Date (for DB expires_at).
 */
function getRefreshTokenExpiryDate() {
  const ms = parseExpiryToMs(authConfig.refreshTokenExpiresIn);
  return new Date(Date.now() + ms);
}

/** Parse jwt-style expiry string (e.g. 7d, 15m, 1h) to milliseconds. */
function parseExpiryToMs(expiry) {
  if (typeof expiry === 'number') return expiry * 1000;
  const match = String(expiry).trim().match(/^(\d+)([smhd])$/i);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const multipliers = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
  return value * (multipliers[unit] || multipliers.d);
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  getRefreshTokenExpiryDate,
  buildAccessPayload,
};
