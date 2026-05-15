const crypto = require('crypto');
const db = require('../db');

/** Hash refresh token for secure DB storage. */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Persist refresh token session (supports multiple devices per user).
 */
async function saveRefreshToken(userId, refreshToken, expiresAt) {
  const tokenHash = hashToken(refreshToken);
  await db.query(
    `INSERT INTO refresh_tokens (user_id, refresh_token, expires_at) VALUES (?, ?, ?)`,
    [userId, tokenHash, expiresAt]
  );
}

/**
 * Find valid session by refresh token string.
 */
async function findValidSession(refreshToken) {
  const tokenHash = hashToken(refreshToken);
  const [rows] = await db.query(
    `SELECT id, user_id, expires_at FROM refresh_tokens
     WHERE refresh_token = ? AND expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );
  return rows[0] || null;
}

/**
 * Remove a single session by refresh token.
 */
async function revokeRefreshToken(refreshToken) {
  const tokenHash = hashToken(refreshToken);
  const [result] = await db.query(
    'DELETE FROM refresh_tokens WHERE refresh_token = ?',
    [tokenHash]
  );
  return result.affectedRows > 0;
}

/**
 * Remove session by DB row id (used during rotation).
 */
async function revokeById(id) {
  await db.query('DELETE FROM refresh_tokens WHERE id = ?', [id]);
}

/**
 * Remove all sessions for a user.
 */
async function revokeAllForUser(userId) {
  await db.query('DELETE FROM refresh_tokens WHERE user_id = ?', [userId]);
}

/**
 * Delete expired tokens (optional housekeeping).
 */
async function purgeExpired() {
  await db.query('DELETE FROM refresh_tokens WHERE expires_at <= NOW()');
}

module.exports = {
  saveRefreshToken,
  findValidSession,
  revokeRefreshToken,
  revokeById,
  revokeAllForUser,
  purgeExpired,
  hashToken,
};
