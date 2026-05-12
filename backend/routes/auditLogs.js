const express = require('express');
const router = express.Router();
const db = require('../db');

// Get audit logs with optional filters
router.get('/', async (req, res) => {
  const { from, to, search, type } = req.query;
  let query = 'SELECT * FROM audit_logs WHERE 1=1';
  const params = [];

  if (from) { query += ' AND logged_at >= ?'; params.push(from); }
  if (to) { query += ' AND logged_at <= DATE_ADD(?, INTERVAL 1 DAY)'; params.push(to); }
  if (type && type !== 'all') { query += ' AND type = ?'; params.push(type); }
  if (search) {
    query += ' AND (description LIKE ? OR username LIKE ? OR action LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s);
  }

  query += ' ORDER BY logged_at DESC LIMIT 500';
  const [rows] = await db.query(query, params);
  res.json(rows);
});

// Get total count
router.get('/count', async (req, res) => {
  const [[{ count }]] = await db.query('SELECT COUNT(*) AS count FROM audit_logs');
  res.json({ count });
});

module.exports = router;
