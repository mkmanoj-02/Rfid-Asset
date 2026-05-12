const express = require('express');
const router  = express.Router();
const db      = require('../db');
const audit   = require('../audit');

// GET all vendors
router.get('/', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM vendors ORDER BY name');
  res.json(rows);
});

// GET single vendor
router.get('/:id', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM vendors WHERE id = ?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ message: 'Not found' });
  res.json(rows[0]);
});

// POST create
router.post('/', async (req, res) => {
  const { name, contact, email, phone, website, description } = req.body;
  if (!name?.trim()) return res.status(400).json({ message: 'Name is required' });

  const [existing] = await db.query('SELECT id FROM vendors WHERE LOWER(name) = LOWER(?)', [name]);
  if (existing.length) return res.status(400).json({ message: `Vendor "${name}" already exists` });

  const [result] = await db.query(
    'INSERT INTO vendors (name, contact, email, phone, website, description) VALUES (?,?,?,?,?,?)',
    [name.trim(), contact || null, email || null, phone || null, website || null, description || null]
  );
  await audit.log('Asset', 'Added', `Vendor "${name}" was created`, req.auditUser, req.auditUserId);
  res.status(201).json({ id: result.insertId, name, contact, email, phone, website, description });
});

// PUT update
router.put('/:id', async (req, res) => {
  const { name, contact, email, phone, website, description } = req.body;
  if (!name?.trim()) return res.status(400).json({ message: 'Name is required' });

  const [existing] = await db.query(
    'SELECT id FROM vendors WHERE LOWER(name) = LOWER(?) AND id != ?', [name, req.params.id]
  );
  if (existing.length) return res.status(400).json({ message: `Vendor "${name}" already exists` });

  await db.query(
    'UPDATE vendors SET name=?, contact=?, email=?, phone=?, website=?, description=? WHERE id=?',
    [name.trim(), contact || null, email || null, phone || null, website || null, description || null, req.params.id]
  );
  await audit.log('Asset', 'Modified', `Vendor "${name}" was updated`, req.auditUser, req.auditUserId);
  res.json({ message: 'Updated' });
});

// BULK DELETE
router.delete('/bulk', async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length)
      return res.status(400).json({ message: 'ids array is required' });

    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await db.query(`SELECT name FROM vendors WHERE id IN (${placeholders})`, ids);
    await db.query(`DELETE FROM vendors WHERE id IN (${placeholders})`, ids);

    for (const row of rows)
      await audit.log('Asset', 'Deleted', `Vendor "${row.name}" was deleted`, req.auditUser, req.auditUserId);

    res.json({ message: `${rows.length} vendor(s) deleted` });
  } catch (err) { next(err); }
});

// DELETE
router.delete('/:id', async (req, res) => {
  const [rows] = await db.query('SELECT name FROM vendors WHERE id = ?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ message: 'Not found' });
  await db.query('DELETE FROM vendors WHERE id = ?', [req.params.id]);
  await audit.log('Asset', 'Deleted', `Vendor "${rows[0].name}" was deleted`, req.auditUser, req.auditUserId);
  res.json({ message: 'Deleted' });
});

module.exports = router;
