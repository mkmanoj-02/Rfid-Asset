const express = require('express');
const router = express.Router();
const db = require('../db');
const audit = require('../audit');

// Get all
router.get('/', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM tag_types ORDER BY name');
  res.json(rows);
});

// Create
router.post('/', async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ message: 'Name is required' });
  const [existing] = await db.query('SELECT id FROM tag_types WHERE LOWER(name)=LOWER(?)', [name]);
  if (existing.length) return res.status(400).json({ message: `Tag type "${name}" already exists` });
  const [result] = await db.query('INSERT INTO tag_types (name, description) VALUES (?,?)', [name, description || null]);
  await audit.log('Asset', 'Added', `Tag type "${name}" was created`, req.auditUser, req.auditUserId);
  res.status(201).json({ id: result.insertId, name, description });
});

// Update
router.put('/:id', async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ message: 'Name is required' });
  const [existing] = await db.query('SELECT id FROM tag_types WHERE LOWER(name)=LOWER(?) AND id!=?', [name, req.params.id]);
  if (existing.length) return res.status(400).json({ message: `Tag type "${name}" already exists` });
  await db.query('UPDATE tag_types SET name=?, description=? WHERE id=?', [name, description || null, req.params.id]);
  await audit.log('Asset', 'Modified', `Tag type "${name}" was updated`, req.auditUser, req.auditUserId);
  res.json({ message: 'Updated' });
});

// Bulk Delete
router.delete('/bulk', async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length)
      return res.status(400).json({ message: 'ids array is required' });

    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await db.query(`SELECT name FROM tag_types WHERE id IN (${placeholders})`, ids);
    await db.query(`DELETE FROM tag_types WHERE id IN (${placeholders})`, ids);

    for (const row of rows)
      await audit.log('Asset', 'Deleted', `Tag type "${row.name}" was deleted`, req.auditUser, req.auditUserId);

    res.json({ message: `${rows.length} tag type(s) deleted` });
  } catch (err) { next(err); }
});

// Delete
router.delete('/:id', async (req, res) => {
  const [rows] = await db.query('SELECT name FROM tag_types WHERE id=?', [req.params.id]);
  await db.query('DELETE FROM tag_types WHERE id=?', [req.params.id]);
  if (rows.length) await audit.log('Asset', 'Deleted', `Tag type "${rows[0].name}" was deleted`, req.auditUser, req.auditUserId);
  res.json({ message: 'Deleted' });
});

module.exports = router;

