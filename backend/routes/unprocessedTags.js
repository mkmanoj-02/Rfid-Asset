const express = require('express');
const router  = express.Router();
const db      = require('../db');
const audit   = require('../audit');

// GET all unprocessed tags (optional search)
router.get('/', async (req, res, next) => {
  try {
    const search = (req.query.search || '').trim();
    let sql = 'SELECT id, tag_value, source, reader_id, notes, created_at FROM unprocessed_tags';
    const params = [];

    if (search) {
      sql += ' WHERE tag_value LIKE ? OR IFNULL(source, "") LIKE ? OR IFNULL(reader_id, "") LIKE ? OR IFNULL(notes, "") LIKE ?';
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }

    sql += ' ORDER BY created_at DESC, id DESC';
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET single
router.get('/:id', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT id, tag_value, source, reader_id, notes, created_at FROM unprocessed_tags WHERE id = ?',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE one
router.delete('/:id', async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT tag_value FROM unprocessed_tags WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Not found' });

    await db.query('DELETE FROM unprocessed_tags WHERE id = ?', [req.params.id]);
    await audit.log(
      'Asset',
      'Deleted',
      `Unprocessed tag "${rows[0].tag_value}" was deleted`,
      req.auditUser,
      req.auditUserId
    );
    res.json({ message: 'Deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
