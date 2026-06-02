const express = require('express');
const router = express.Router();
const db = require('../db');
const audit = require('../audit');
const resourceImages = require('../controllers/resourceImages');
const { uploadImageMiddleware, handleMulterImageError } = require('../helper/upload');
const { optionalImageUpload } = require('../middleware/optionalImageUpload');
const {
  imageUrlFromUpload,
  resolveLocationImageOnUpdate,
  cleanupLocationImageOnDelete,
  truthyFormFlag,
} = require('../controllers/locationImages');
const { assertLocationAccess } = require('../lib/userAuthz');
const { requireModify, requireDelete } = require('../middleware/requireAuthz');

function allowedLocationIds(req) {
  return req.authz?.locationIds ?? null;
}

// Get all locations as a flat list with parent info
router.get('/', async (req, res) => {
  const allowedIds = allowedLocationIds(req);

  let query = `SELECT l.*, p.name AS parent_name, lt.name AS location_type_name
    FROM locations l
    LEFT JOIN locations p ON l.parent_id = p.id
    LEFT JOIN location_types lt ON l.location_type_id = lt.id`;
  const params = [];
  if (allowedIds) {
    query += ` WHERE l.id IN (${allowedIds.map(() => '?').join(',')})`;
    params.push(...allowedIds);
  }
  query += ' ORDER BY l.parent_id, l.name';
  const [rows] = await db.query(query, params);
  res.json(rows);
});

// Get tree structure
router.get('/tree', async (req, res) => {
  const allowedIds = allowedLocationIds(req);

  let query = 'SELECT * FROM locations';
  const params = [];
  if (allowedIds) {
    query += ` WHERE id IN (${allowedIds.map(() => '?').join(',')})`;
    params.push(...allowedIds);
  }
  query += ' ORDER BY parent_id, name';
  const [rows] = await db.query(query, params);
  const buildTree = (items, parentId = null) =>
    items.filter(i => (i.parent_id || null) == parentId).map(i => ({ ...i, children: buildTree(items, i.id) }));
  res.json(buildTree(rows));
});

router.post(
  '/:id/image',
  requireModify('location'),
  uploadImageMiddleware('locations'),
  handleMulterImageError,
  resourceImages.upload('locations')
);
router.delete('/:id/image', requireModify('location'), resourceImages.remove('locations'));

router.get('/:id', async (req, res) => {
  const locErr = assertLocationAccess(req.authz, res, req.params.id);
  if (locErr) return locErr;

  const [rows] = await db.query(`
    SELECT l.*, p.name AS parent_name 
    FROM locations l LEFT JOIN locations p ON l.parent_id = p.id
    WHERE l.id = ?`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ message: 'Not found' });
  res.json(rows[0]);
});

router.post('/', requireModify('location'), optionalImageUpload('locations'), async (req, res, next) => {
  try {
  const { name, description, parent_id } = req.body;
  if (!name || !String(name).trim()) {
    if (req.file?.path) {
      try { await require('fs').promises.unlink(req.file.path); } catch {}
    }
    return res.status(400).json({ message: 'Location name is required' });
  }
  const pid = parent_id === undefined || parent_id === null || parent_id === '' ? null : parent_id;
  const [existing] = await db.query(
    `SELECT id 
     FROM locations 
     WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))
     AND (
       (parent_id IS NULL AND ? IS NULL)
       OR parent_id = ?
     )`,
    [name, pid, pid]
  );
  if (existing.length) {
    return res.status(400).json({
      message: pid
        ? `Child location "${name}" already exists under this parent`
        : `Parent location "${name}" already exists`,
    });
  }
  const imageUrl = imageUrlFromUpload(req.file);

  const [result] = await db.query(
    'INSERT INTO locations (name, description, parent_id, location_type_id, image_url) VALUES (?, ?, ?, ?, ?)',
    [name, description || null, parent_id || null, req.body.location_type_id || null, imageUrl]
  );
  await audit.log('Location', 'Added', `Location "${name}" was created`, req.auditUser, req.auditUserId);
  res.status(201).json({
    id: result.insertId,
    name,
    description,
    parent_id: parent_id || null,
    image_url: imageUrl,
  });
  } catch (err) { next(err); }
});

router.put('/:id', requireModify('location'), optionalImageUpload('locations'), async (req, res, next) => {
  try {
  const locErr = assertLocationAccess(req.authz, res, req.params.id);
  if (locErr) return locErr;

  const { name, description, parent_id } = req.body;
  const pid = parent_id === undefined || parent_id === null || parent_id === '' ? null : parent_id;
  const [existing] = await db.query(
    `SELECT id 
     FROM locations 
     WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))
     AND (
       (parent_id IS NULL AND ? IS NULL)
       OR parent_id = ?
     )
     AND id != ?`,
    [name, pid, pid, req.params.id]
  );
  if (existing.length) {
    if (req.file?.path) {
      try { await require('fs').promises.unlink(req.file.path); } catch {}
    }
    return res.status(400).json({
      message: pid
        ? `Child location "${name}" already exists under this parent`
        : `Parent location "${name}" already exists`,
    });
  }

  const [[locRow]] = await db.query('SELECT image_url FROM locations WHERE id = ?', [req.params.id]);
  if (!locRow) {
    if (req.file?.path) {
      try { await require('fs').promises.unlink(req.file.path); } catch {}
    }
    return res.status(404).json({ message: 'Not found' });
  }

  const imageUrl = await resolveLocationImageOnUpdate(
    locRow.image_url,
    req.file,
    truthyFormFlag(req.body.remove_image)
  );

  await db.query(
    'UPDATE locations SET name = ?, description = ?, parent_id = ?, location_type_id = ?, image_url = ? WHERE id = ?',
    [name, description || null, parent_id || null, req.body.location_type_id || null, imageUrl, req.params.id]
  );
  await audit.log('Location', 'Modified', `Location "${name}" was updated`, req.auditUser, req.auditUserId);
  res.json({ message: 'Updated', image_url: imageUrl });
  } catch (err) { next(err); }
});

router.delete('/bulk', requireDelete('location'), async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length)
      return res.status(400).json({ message: 'ids array is required' });

    for (const rawId of ids) {
      const locErr = assertLocationAccess(req.authz, res, rawId);
      if (locErr) return locErr;
    }

    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await db.query(
      `SELECT id, name, image_url FROM locations WHERE id IN (${placeholders})`,
      ids
    );
    for (const row of rows) await cleanupLocationImageOnDelete(row);
    await db.query(`DELETE FROM locations WHERE id IN (${placeholders})`, ids);
    for (const row of rows)
      await audit.log('Location', 'Deleted', `Location "${row.name}" was deleted`, req.auditUser, req.auditUserId);
    res.json({ message: `${rows.length} location(s) deleted` });
  } catch (e) { next(e); }
});

router.delete('/:id', requireDelete('location'), async (req, res, next) => {
  try {
    const locErr = assertLocationAccess(req.authz, res, req.params.id);
    if (locErr) return locErr;

    const [rows] = await db.query('SELECT name, image_url FROM locations WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Not found' });
    await cleanupLocationImageOnDelete(rows[0]);
    await db.query('DELETE FROM locations WHERE id = ?', [req.params.id]);
    await audit.log('Location', 'Deleted', `Location "${rows[0].name}" was deleted`, req.auditUser, req.auditUserId);
    res.json({ message: 'Deleted' });
  } catch (e) { next(e); }
});

module.exports = router;
