const express = require('express');
const router = express.Router();
const db = require('../db');
const audit = require('../audit');
const { locationTypeAllowed, deny } = require('../lib/userAuthz');
const { requireModify, requireDelete } = require('../middleware/requireAuthz');

// Get all
router.get('/', async (req, res) => {
  const allowedIds = req.authz?.locationTypeIds ?? null;
  let query = 'SELECT * FROM location_types';
  const params = [];
  if (allowedIds?.length) {
    query += ` WHERE id IN (${allowedIds.map(() => '?').join(',')})`;
    params.push(...allowedIds);
  }
  query += ' ORDER BY name';
  const [rows] = await db.query(query, params);
  res.json(rows);
});

// Create
router.post('/', requireModify('location_type'), async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ message: 'Name is required' });
  const [existing] = await db.query('SELECT id FROM location_types WHERE LOWER(name)=LOWER(?)', [name]);
  if (existing.length) return res.status(400).json({ message: `Location type "${name}" already exists` });
  const [result] = await db.query('INSERT INTO location_types (name, description) VALUES (?,?)', [name, description || null]);
  await audit.log('Location', 'Added', `Location type "${name}" was created`, req.auditUser, req.auditUserId);
  res.status(201).json({ id: result.insertId, name, description });
});

// Update
router.put('/:id', requireModify('location_type'), async (req, res) => {
  if (!locationTypeAllowed(req.authz, req.params.id)) {
    return deny(res, 'You do not have access to this location type');
  }
  const { name, description } = req.body;
  const [existing] = await db.query('SELECT id FROM location_types WHERE LOWER(name)=LOWER(?) AND id!=?', [name, req.params.id]);
  if (existing.length) return res.status(400).json({ message: `Location type "${name}" already exists` });
  await db.query('UPDATE location_types SET name=?, description=? WHERE id=?', [name, description || null, req.params.id]);
  await audit.log('Location', 'Modified', `Location type "${name}" was updated`, req.auditUser, req.auditUserId);
  res.json({ message: 'Updated' });
});

// Bulk Delete
router.delete('/bulk', requireDelete('location_type'), async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length)
      return res.status(400).json({ message: 'ids array is required' });

    for (const rawId of ids) {
      if (!locationTypeAllowed(req.authz, rawId)) {
        return deny(res, 'You do not have access to this location type');
      }
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
router.delete('/:id', requireDelete('location_type'), async (req, res) => {
  if (!locationTypeAllowed(req.authz, req.params.id)) {
    return deny(res, 'You do not have access to this location type');
  }
  const [rows] = await db.query('SELECT name FROM location_types WHERE id=?', [req.params.id]);
  await db.query('DELETE FROM location_types WHERE id=?', [req.params.id]);
  if (rows.length) await audit.log('Location', 'Deleted', `Location type "${rows[0].name}" was deleted`, req.auditUser, req.auditUserId);
  res.json({ message: 'Deleted' });
});

module.exports = router;
