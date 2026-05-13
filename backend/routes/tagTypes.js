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


// Get recommendation for an asset type
router.get('/recommend/:asset_type_id', async (req, res) => {
  const [rows] = await db.query(`
    SELECT tt.*, attr.reason
    FROM asset_type_tag_recommendations attr
    JOIN tag_types tt ON attr.tag_type_id = tt.id
    WHERE attr.asset_type_id = ?
    LIMIT 1
  `, [req.params.asset_type_id]);
  res.json(rows[0] || null);
});

// Get all recommendations
router.get('/recommendations', async (req, res) => {
  const [rows] = await db.query(`
    SELECT attr.*, at.name AS asset_type_name, tt.name AS tag_type_name
    FROM asset_type_tag_recommendations attr
    JOIN asset_types at ON attr.asset_type_id = at.id
    JOIN tag_types tt ON attr.tag_type_id = tt.id
    ORDER BY at.name
  `);
  res.json(rows);
});

// Save recommendation for asset type
router.post('/recommendations', async (req, res) => {
  const { asset_type_id, tag_type_id, reason } = req.body;
  await db.query(`
    INSERT INTO asset_type_tag_recommendations (asset_type_id, tag_type_id, reason)
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE tag_type_id = ?, reason = ?
  `, [asset_type_id, tag_type_id, reason || null, tag_type_id, reason || null]);
  res.json({ message: 'Saved' });
});

// Delete recommendation
router.delete('/recommendations/:asset_type_id', async (req, res) => {
  await db.query('DELETE FROM asset_type_tag_recommendations WHERE asset_type_id = ?', [req.params.asset_type_id]);
  res.json({ message: 'Deleted' });
});


module.exports = router;

