const bcrypt = require('bcryptjs');
const db = require('../db');
const audit = require('../audit');
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  getRefreshTokenExpiryDate,
} = require('../helpers/jwt');
const refreshTokenService = require('../services/refreshTokenService');

const AUTH_USER_SELECT = `
  id, username, email, profile_type,
  location_privileges, location_can_modify, location_can_delete,
  location_type_privileges, location_type_can_modify, location_type_can_delete,
  asset_type_privileges, asset_type_can_modify, asset_type_can_delete,
  asset_privileges, asset_can_modify, asset_can_delete
`;

function asBool(v) {
  return v === 1 || v === true || v === '1';
}

/** Public user fields returned after login and /auth/me. */
function toAuthUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    profile_type: user.profile_type,
    location_privileges: user.location_privileges,
    location_can_modify: asBool(user.location_can_modify),
    location_can_delete: asBool(user.location_can_delete),
    location_type_privileges: user.location_type_privileges,
    location_type_can_modify: asBool(user.location_type_can_modify),
    location_type_can_delete: asBool(user.location_type_can_delete),
    asset_type_privileges: user.asset_type_privileges,
    asset_type_can_modify: asBool(user.asset_type_can_modify),
    asset_type_can_delete: asBool(user.asset_type_can_delete),
    asset_privileges: user.asset_privileges,
    asset_can_modify: asBool(user.asset_can_modify),
    asset_can_delete: asBool(user.asset_can_delete),
  };
}

/**
 * POST /api/auth/login
 */
async function login(req, res) {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      status: false,
      message: 'Username and password are required',
    });
  }

  const [rows] = await db.query(
    `SELECT ${AUTH_USER_SELECT}, password_hash FROM users WHERE username = ? LIMIT 1`,
    [username.trim()]
  );

  if (!rows.length) {
    await audit.log('Login Failure', 'Login Failure', `User ${username} login failed — user not found`, username);
    return res.status(401).json({
      status: false,
      message: 'Invalid username or password',
    });
  }

  const user = rows[0];
  const valid = await bcrypt.compare(password, user.password_hash);

  if (!valid) {
    await audit.log('Login Failure', 'Login Failure', `User ${username} login failed — wrong password`, username, user.id);
    return res.status(401).json({
      status: false,
      message: 'Invalid username or password',
    });
  }

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);
  const expiresAt = getRefreshTokenExpiryDate();

  await refreshTokenService.saveRefreshToken(user.id, refreshToken, expiresAt);
  await db.query('INSERT INTO login_logs (user_id, username) VALUES (?, ?)', [user.id, user.username]);
  await audit.log('Login', 'User Logged In', `User ${username} signed in`, username, user.id);

  return res.json({
    status: true,
    message: 'Login successful',
    user: toAuthUser(user),
    accessToken,
    refreshToken,
  });
}

/**
 * POST /api/auth/refresh-token
 * Validates refresh JWT + DB session; rotates refresh token; returns new access token.
 */
async function refreshToken(req, res) {
  const { refreshToken: token } = req.body;

  if (!token) {
    return res.status(400).json({
      status: false,
      message: 'refreshToken is required',
    });
  }

  let decoded;
  try {
    decoded = verifyRefreshToken(token);
  } catch (err) {
    const expired = err.name === 'TokenExpiredError';
    return res.status(expired ? 403 : 403).json({
      status: false,
      message: expired ? 'Refresh token expired' : 'Invalid refresh token',
    });
  }

  const session = await refreshTokenService.findValidSession(token);
  if (!session || session.user_id !== decoded.id) {
    return res.status(403).json({
      status: false,
      message: 'Invalid or revoked refresh token',
    });
  }

  const [users] = await db.query(
    'SELECT id, username, profile_type FROM users WHERE id = ? LIMIT 1',
    [decoded.id]
  );
  if (!users.length) {
    await refreshTokenService.revokeById(session.id);
    return res.status(403).json({
      status: false,
      message: 'User account no longer exists',
      code: 'USER_NOT_FOUND',
    });
  }

  const user = users[0];
  const accessToken = generateAccessToken(user);

  // Rotate refresh token (enterprise best practice)
  const newRefreshToken = generateRefreshToken(user);
  const expiresAt = getRefreshTokenExpiryDate();
  await refreshTokenService.revokeById(session.id);
  await refreshTokenService.saveRefreshToken(user.id, newRefreshToken, expiresAt);

  return res.json({
    status: true,
    message: 'Token refreshed',
    accessToken,
    refreshToken: newRefreshToken,
  });
}

/**
 * POST /api/auth/logout
 * Revokes refresh token session.
 */
async function logout(req, res) {
  const { refreshToken: token } = req.body;

  if (!token) {
    return res.status(400).json({
      status: false,
      message: 'refreshToken is required',
    });
  }

  const revoked = await refreshTokenService.revokeRefreshToken(token);

  if (req.user?.id) {
    await audit.log('Logout', 'User Logged Out', `User ${req.user.username} signed out`, req.user.username, req.user.id);
  }

  return res.json({
    status: true,
    message: revoked ? 'Logout successful' : 'Session already ended',
  });
}

/**
 * GET /api/auth/me — current user from access token.
 */
async function me(req, res) {
  const [rows] = await db.query(
    `SELECT ${AUTH_USER_SELECT} FROM users WHERE id = ? LIMIT 1`,
    [req.user.id]
  );

  if (!rows.length) {
    return res.status(401).json({ status: false, message: 'User not found' });
  }

  return res.json({ status: true, user: toAuthUser(rows[0]) });
}

/**
 * GET /api/auth/protected-sample — example protected route.
 */
async function protectedSample(req, res) {
  return res.json({
    status: true,
    message: 'Protected route accessed successfully',
    user: req.user,
  });
}

module.exports = {
  login,
  refreshToken,
  logout,
  me,
  protectedSample,
};
