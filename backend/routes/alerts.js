const express = require('express');
const router = express.Router();
const db = require('../db');

// Get alerts, optionally filtered by type
router.get('/', async (req, res) => {
  const { filter_type } = req.query;
  let query = 'SELECT * FROM alerts';
  const params = [];
  if (filter_type) { query += ' WHERE filter_type = ?'; params.push(filter_type); }
  query += ' ORDER BY alert_time DESC LIMIT 500';
  const [rows] = await db.query(query, params);
  res.json(rows);
});

// Get unread count
router.get('/unread-count', async (req, res) => {
  const [[{ count }]] = await db.query('SELECT COUNT(*) AS count FROM alerts WHERE is_read = 0');
  res.json({ count });
});

// Mark all as read
router.put('/mark-read', async (req, res) => {
  await db.query('UPDATE alerts SET is_read = 1');
  res.json({ message: 'Marked read' });
});

// Mark single as read
router.put('/:id/read', async (req, res) => {
  await db.query('UPDATE alerts SET is_read = 1 WHERE id = ?', [req.params.id]);
  res.json({ message: 'Marked read' });
});

// Bulk delete alerts
router.delete('/bulk', async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length)
      return res.status(400).json({ message: 'ids array is required' });

    const placeholders = ids.map(() => '?').join(',');
    await db.query(`DELETE FROM alerts WHERE id IN (${placeholders})`, ids);
    res.json({ message: `${ids.length} alert(s) deleted` });
  } catch (err) { next(err); }
});

// Delete alert
router.delete('/:id', async (req, res) => {
  await db.query('DELETE FROM alerts WHERE id = ?', [req.params.id]);
  res.json({ message: 'Deleted' });
});

// Clear all alerts
router.delete('/', async (req, res) => {
  await db.query('DELETE FROM alerts');
  res.json({ message: 'Cleared' });
});

module.exports = router;
