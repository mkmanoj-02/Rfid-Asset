const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const verifyToken = require('../middleware/verifyToken');
const authorizeRoles = require('../middleware/authorizeRoles');
const attachUserContext = require('../middleware/attachUserContext');

// ── Public ─────────────────────────────────────────────────────
router.post('/login', authController.login);
router.post('/refresh-token', authController.refreshToken);
router.post('/logout', authController.logout);

// ── Protected ──────────────────────────────────────────────────
router.get('/me', verifyToken, attachUserContext, authController.me);
router.get(
  '/protected-sample',
  verifyToken,
  attachUserContext,
  authorizeRoles('super_admin', 'admin'),
  authController.protectedSample
);

module.exports = router;
