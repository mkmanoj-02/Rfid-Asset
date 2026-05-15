const express = require('express');
const router = express.Router();
const db = require('../db');
const audit = require('../audit');
const resourceImages = require('../controllers/resourceImages');
const { uploadImageMiddleware, handleMulterImageError } = require('../helper/upload');

// Helper: parse privilege array from user record
function parsePriv(val) {
  if (!val) return null;
  if (Array.isArray(val)) return val.length ? val : null;
  try { const p = JSON.parse(val); return p && p.length ? p : null; } catch { return null; }
}

// Expand a list of location IDs to include all their sub-locations recursively
async function expandWithSubLocations(ids) {
  if (!ids || !ids.length) return ids;
  const [all] = await db.query('SELECT id, parent_id FROM locations');
  const result = new Set(ids.map(Number));
  const addChildren = (pid) => {
    all.filter(l => l.parent_id === pid).forEach(l => {
      if (!result.has(l.id)) { result.add(l.id); addChildren(l.id); }
    });
  };
  ids.forEach(id => addChildren(Number(id)));
  return [...result];
}

// Get all locations as a flat list with parent info
router.get('/', async (req, res) => {
  const { user_id } = req.query;
  let allowedIds = null;

  if (user_id) {
    const [users] = await db.query('SELECT location_privileges, profile_type FROM users WHERE id = ?', [user_id]);
    if (users.length && users[0].profile_type !== 'super_admin') {
      const base = parsePriv(users[0].location_privileges);
      allowedIds = base ? await expandWithSubLocations(base) : null;
    }
  }

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
  const { user_id } = req.query;
  let allowedIds = null;

  if (user_id) {
    const [users] = await db.query('SELECT location_privileges, profile_type FROM users WHERE id = ?', [user_id]);
    if (users.length && users[0].profile_type !== 'super_admin') {
      const base = parsePriv(users[0].location_privileges);
      allowedIds = base ? await expandWithSubLocations(base) : null;
    }
  }

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

// --- Image: multipart field "image" (jpg, jpeg, png, webp; max 5MB) ---
router.post(
  '/:id/image',
  uploadImageMiddleware('locations'),
  handleMulterImageError,
  resourceImages.upload('locations')
);
router.delete('/:id/image', resourceImages.remove('locations'));

router.get('/:id', async (req, res) => {
  const [rows] = await db.query(`
    SELECT l.*, p.name AS parent_name 
    FROM locations l LEFT JOIN locations p ON l.parent_id = p.id
    WHERE l.id = ?`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ message: 'Not found' });

  // Privilege check — non-super-admins can only fetch locations they are allowed to see
  const userId = req.headers['x-user-id'];
  if (userId) {
    const [users] = await db.query('SELECT location_privileges, profile_type FROM users WHERE id = ?', [userId]);
    if (users.length && users[0].profile_type !== 'super_admin') {
      const base = parsePriv(users[0].location_privileges);
      if (base) {
        const allowed = await expandWithSubLocations(base);
        if (!allowed.includes(Number(req.params.id)))
          return res.status(403).json({ message: 'Access denied to this location' });
      }
    }
  }

  res.json(rows[0]);
});

router.post('/', async (req, res) => {
  const { name, description, parent_id } = req.body;
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
  const [result] = await db.query('INSERT INTO locations (name, description, parent_id, location_type_id) VALUES (?, ?, ?, ?)',
    [name, description, parent_id || null, req.body.location_type_id || null]);
  await audit.log('Location', 'Added', `Location "${name}" was created`, req.auditUser, req.auditUserId);
  res.status(201).json({ id: result.insertId, name, description, parent_id: parent_id || null });
});

router.put('/:id', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (userId) {
    const [users] = await db.query('SELECT location_can_modify, profile_type FROM users WHERE id = ?', [userId]);
    if (users.length && users[0].profile_type !== 'super_admin' && !users[0].location_can_modify)
      return res.status(403).json({ message: 'You do not have permission to modify locations' });
  }
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
    return res.status(400).json({
      message: pid
        ? `Child location "${name}" already exists under this parent`
        : `Parent location "${name}" already exists`,
    });
  }
  await db.query(
    'UPDATE locations SET name = ?, description = ?, parent_id = ?, location_type_id = ? WHERE id = ?',
    [name, description, parent_id || null, req.body.location_type_id || null, req.params.id]
  );
  await audit.log('Location', 'Modified', `Location "${name}" was updated`, req.auditUser, req.auditUserId);
  res.json({ message: 'Updated' });
});

router.delete('/bulk', async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length)
      return res.status(400).json({ message: 'ids array is required' });

    const userId = req.headers['x-user-id'];
    if (userId) {
      const [users] = await db.query('SELECT location_can_delete, profile_type FROM users WHERE id = ?', [userId]);
      if (users.length && users[0].profile_type !== 'super_admin' && !users[0].location_can_delete)
        return res.status(403).json({ message: 'You do not have permission to delete locations' });
    }

    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await db.query(`SELECT name FROM locations WHERE id IN (${placeholders})`, ids);
    await db.query(`DELETE FROM locations WHERE id IN (${placeholders})`, ids);

    for (const row of rows)
      await audit.log('Location', 'Deleted', `Location "${row.name}" was deleted`, req.auditUser, req.auditUserId);

    res.json({ message: `${rows.length} location(s) deleted` });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res) => {
  const [rows] = await db.query('SELECT name FROM locations WHERE id = ?', [req.params.id]);
  await db.query('DELETE FROM locations WHERE id = ?', [req.params.id]);
  if (rows.length) await audit.log('Location', 'Deleted', `Location "${rows[0].name}" was deleted`, req.auditUser, req.auditUserId);
  res.json({ message: 'Deleted' });
});

module.exports = router;
