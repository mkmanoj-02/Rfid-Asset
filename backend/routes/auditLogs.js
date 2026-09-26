const express = require('express');
const router = express.Router();
const db = require('../db');

// Get audit logs with optional filters + pagination
router.get('/', async (req, res, next) => {
  try {
    const { from, to, search, type, page, limit } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(500, Math.max(1, parseInt(limit, 10) || 25));
    const offset = (pageNum - 1) * pageSize;

    let where = ' WHERE 1=1';
    const params = [];

    if (from) {
      where += ' AND logged_at >= ?';
      params.push(from);
    }
    if (to) {
      where += ' AND logged_at <= DATE_ADD(?, INTERVAL 1 DAY)';
      params.push(to);
    }
    if (type && type !== 'all') {
      where += ' AND type = ?';
      params.push(type);
    }
    if (search) {
      where += ' AND (description LIKE ? OR username LIKE ? OR action LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM audit_logs${where}`,
      params
    );

    const [rows] = await db.query(
      `SELECT * FROM audit_logs${where} ORDER BY logged_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    res.json({
      data: rows,
      pagination: {
        total: total || 0,
        page: pageNum,
        limit: pageSize,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Get total count
router.get('/count', async (req, res, next) => {
  try {
    const [[{ count }]] = await db.query('SELECT COUNT(*) AS count FROM audit_logs');
    res.json({ count });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
