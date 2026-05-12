const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');
const audit = require('../audit');

// Validate current session / stored user
router.get('/me', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ message: 'Not authenticated' });

  const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
  if (!rows.length) return res.status(401).json({ message: 'User not found' });

  const { password_hash, ...userInfo } = rows[0];
  res.json({ user: userInfo });
});

// Login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password required' });
  }

  const [rows] = await db.query('SELECT * FROM users WHERE username = ?', [username]);

  if (!rows.length) {
    await audit.log('Login Failure', 'Login Failure', `User ${username} login failed — user not found`, username);
    return res.status(401).json({ message: 'Invalid username or password' });
  }

  const user = rows[0];
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    await audit.log('Login Failure', 'Login Failure', `User ${username} login failed — wrong password`, username, user.id);
    return res.status(401).json({ message: 'Invalid username or password' });
  }

  // Log the login
  await db.query('INSERT INTO login_logs (user_id, username) VALUES (?, ?)', [user.id, user.username]);
  await audit.log('Login', 'User Logged In', `User ${username} signed in`, username, user.id);

  const { password_hash, ...userInfo } = user;
  res.json({ user: userInfo });
});

module.exports = router;
