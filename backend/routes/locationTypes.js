const express = require('express');
const router = express.Router();
const db = require('../db');
const audit = require('../audit');

// Get all
router.get('/', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM location_types ORDER BY name');
  res.json(rows);
});

// Create
router.post('/', async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ message: 'Name is required' });
  const [existing] = await db.query('SELECT id FROM location_types WHERE LOWER(name)=LOWER(?)', [name]);
  if (existing.length) return res.status(400).json({ message: `Location type "${name}" already exists` });
  const [result] = await db.query('INSERT INTO location_types (name, description) VALUES (?,?)', [name, description || null]);
  await audit.log('Location', 'Added', `Location type "${name}" was created`, req.auditUser, req.auditUserId);
  res.status(201).json({ id: result.insertId, name, description });
});

// Update
router.put('/:id', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (userId) {
    const [users] = await db.query('SELECT location_type_can_modify, profile_type FROM users WHERE id = ?', [userId]);
    if (users.length && users[0].profile_type !== 'super_admin' && !users[0].location_type_can_modify)
      return res.status(403).json({ message: 'You do not have permission to modify location types' });
  }
  const { name, description } = req.body;
  const [existing] = await db.query('SELECT id FROM location_types WHERE LOWER(name)=LOWER(?) AND id!=?', [name, req.params.id]);
  if (existing.length) return res.status(400).json({ message: `Location type "${name}" already exists` });
  await db.query('UPDATE location_types SET name=?, description=? WHERE id=?', [name, description || null, req.params.id]);
  await audit.log('Location', 'Modified', `Location type "${name}" was updated`, req.auditUser, req.auditUserId);
  res.json({ message: 'Updated' });
});

// Bulk Delete
router.delete('/bulk', async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length)
      return res.status(400).json({ message: 'ids array is required' });

    const userId = req.headers['x-user-id'];
    if (userId) {
      const [users] = await db.query('SELECT location_type_can_delete, profile_type FROM users WHERE id = ?', [userId]);
      if (users.length && users[0].profile_type !== 'super_admin' && !users[0].location_type_can_delete)
        return res.status(403).json({ message: 'You do not have permission to delete location types' });
    }

    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await db.query(`SELECT name FROM location_types WHERE id IN (${placeholders})`, ids);
    await db.query(`DELETE FROM location_types WHERE id IN (${placeholders})`, ids);

    for (const row of rows)
      await audit.log('Location', 'Deleted', `Location type "${row.name}" was deleted`, req.auditUser, req.auditUserId);

    res.json({ message: `${rows.length} location type(s) deleted` });
  } catch (err) { next(err); }
});

// Delete
router.delete('/:id', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (userId) {
    const [users] = await db.query('SELECT location_type_can_delete, profile_type FROM users WHERE id = ?', [userId]);
    if (users.length && users[0].profile_type !== 'super_admin' && !users[0].location_type_can_delete)
      return res.status(403).json({ message: 'You do not have permission to delete location types' });
  }
  const [rows] = await db.query('SELECT name FROM location_types WHERE id=?', [req.params.id]);
  await db.query('DELETE FROM location_types WHERE id=?', [req.params.id]);
  if (rows.length) await audit.log('Location', 'Deleted', `Location type "${rows[0].name}" was deleted`, req.auditUser, req.auditUserId);
  res.json({ message: 'Deleted' });
});

module.exports = router;
