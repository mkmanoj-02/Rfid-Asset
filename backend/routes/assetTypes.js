const express = require('express');
const router = express.Router();
const db = require('../db');
const audit = require('../audit');

// Helper: parse privilege array
function parsePriv(val) {
  if (!val) return null;
  if (Array.isArray(val)) return val.length ? val : null;
  try { const p = JSON.parse(val); return p && p.length ? p : null; } catch { return null; }
}

router.get('/', async (req, res) => {
  const { user_id } = req.query;
  let allowedIds = null;

  if (user_id) {
    const [users] = await db.query('SELECT asset_type_privileges, profile_type FROM users WHERE id = ?', [user_id]);
    if (users.length && users[0].profile_type !== 'super_admin') {
      allowedIds = parsePriv(users[0].asset_type_privileges);
    }
  }

  let query = `SELECT at.*, p.name AS parent_name FROM asset_types at LEFT JOIN asset_types p ON at.parent_id = p.id`;
  const params = [];
  if (allowedIds) {
    query += ` WHERE at.id IN (${allowedIds.map(() => '?').join(',')})`;
    params.push(...allowedIds);
  }
  query += ' ORDER BY p.name, at.name';
  const [rows] = await db.query(query, params);
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM asset_types WHERE id = ?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ message: 'Not found' });
  res.json(rows[0]);
});

router.post('/', async (req, res) => {
  const { name, description } = req.body;
  const [existing] = await db.query('SELECT id FROM asset_types WHERE LOWER(name) = LOWER(?)', [name]);
  if (existing.length) return res.status(400).json({ message: `Asset type "${name}" already exists` });
  const [result] = await db.query('INSERT INTO asset_types (name, description, parent_id) VALUES (?, ?, ?)',
    [name, description, req.body.parent_id || null]);
  await audit.log('Asset Type', 'Added', `Asset type "${name}" was created`, req.auditUser, req.auditUserId);
  res.status(201).json({ id: result.insertId, name, description });
});

router.put('/:id', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (userId) {
    const [users] = await db.query('SELECT asset_type_can_modify, profile_type FROM users WHERE id = ?', [userId]);
    if (users.length && users[0].profile_type !== 'super_admin' && !users[0].asset_type_can_modify)
      return res.status(403).json({ message: 'You do not have permission to modify asset types' });
  }
  const { name, description } = req.body;
  const [existing] = await db.query('SELECT id FROM asset_types WHERE LOWER(name) = LOWER(?) AND id != ?', [name, req.params.id]);
  if (existing.length) return res.status(400).json({ message: `Asset type "${name}" already exists` });
  await db.query('UPDATE asset_types SET name = ?, description = ?, parent_id = ? WHERE id = ?',
    [name, description, req.body.parent_id || null, req.params.id]);
  await audit.log('Asset Type', 'Modified', `Asset type "${name}" was updated`, req.auditUser, req.auditUserId);
  res.json({ message: 'Updated' });
});

router.delete('/bulk', async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length)
      return res.status(400).json({ message: 'ids array is required' });

    const userId = req.headers['x-user-id'];
    if (userId) {
      const [users] = await db.query('SELECT asset_type_can_delete, profile_type FROM users WHERE id = ?', [userId]);
      if (users.length && users[0].profile_type !== 'super_admin' && !users[0].asset_type_can_delete)
        return res.status(403).json({ message: 'You do not have permission to delete asset types' });
    }

    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await db.query(`SELECT name FROM asset_types WHERE id IN (${placeholders})`, ids);
    await db.query(`DELETE FROM asset_types WHERE id IN (${placeholders})`, ids);

    for (const row of rows)
      await audit.log('Asset Type', 'Deleted', `Asset type "${row.name}" was deleted`, req.auditUser, req.auditUserId);

    res.json({ message: `${rows.length} asset type(s) deleted` });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res) => {
  await db.query('DELETE FROM asset_types WHERE id = ?', [req.params.id]);
  if (rows.length) await audit.log('Asset Type', 'Deleted', `Asset type "${rows[0].name}" was deleted`, req.auditUser, req.auditUserId);
  res.json({ message: 'Deleted' });
});

// --- Attributes ---

// Get all attributes for an asset type (with list options)
router.get('/:id/attributes', async (req, res) => {
  const [attrs] = await db.query(
    'SELECT * FROM asset_type_attributes WHERE asset_type_id = ? ORDER BY sort_order, id',
    [req.params.id]
  );
  for (const attr of attrs) {
    if (attr.attr_type === 'list') {
      const [opts] = await db.query(
        'SELECT * FROM attribute_list_options WHERE attribute_id = ? ORDER BY sort_order, id',
        [attr.id]
      );
      attr.list_options = opts;
    } else {
      attr.list_options = [];
    }
  }
  res.json(attrs);
});

// Add attribute to asset type
router.post('/:id/attributes', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (userId) {
    const [users] = await db.query('SELECT asset_type_can_modify, profile_type FROM users WHERE id = ?', [userId]);
    if (users.length && users[0].profile_type !== 'super_admin' && !users[0].asset_type_can_modify)
      return res.status(403).json({ message: 'You do not have permission to modify asset types' });
  }
  const { name, attr_type, default_value, list_options } = req.body;
  const [result] = await db.query(
    'INSERT INTO asset_type_attributes (asset_type_id, name, attr_type, default_value) VALUES (?, ?, ?, ?)',
    [req.params.id, name, attr_type, default_value || null]
  );
  const attrId = result.insertId;

  // Save list options if type is list
  if (attr_type === 'list' && list_options && list_options.length) {
    for (let i = 0; i < list_options.length; i++) {
      await db.query(
        'INSERT INTO attribute_list_options (attribute_id, option_value, sort_order) VALUES (?, ?, ?)',
        [attrId, list_options[i], i]
      );
    }
  }

  // Percolate: add empty value for all existing assets of this type
  const [assets] = await db.query('SELECT id FROM assets WHERE asset_type_id = ?', [req.params.id]);
  for (const asset of assets) {
    await db.query(
      'INSERT IGNORE INTO asset_attribute_values (asset_id, attribute_id, value) VALUES (?, ?, NULL)',
      [asset.id, attrId]
    );
  }

  res.status(201).json({ id: attrId, name, attr_type });
});

// Update attribute
router.put('/:typeId/attributes/:attrId', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (userId) {
    const [users] = await db.query('SELECT asset_type_can_modify, profile_type FROM users WHERE id = ?', [userId]);
    if (users.length && users[0].profile_type !== 'super_admin' && !users[0].asset_type_can_modify)
      return res.status(403).json({ message: 'You do not have permission to modify asset types' });
  }
  const { name, attr_type, default_value, list_options } = req.body;
  await db.query(
    'UPDATE asset_type_attributes SET name = ?, attr_type = ?, default_value = ? WHERE id = ? AND asset_type_id = ?',
    [name, attr_type, default_value || null, req.params.attrId, req.params.typeId]
  );
  if (attr_type === 'list') {
    await db.query('DELETE FROM attribute_list_options WHERE attribute_id = ?', [req.params.attrId]);
    if (list_options && list_options.length) {
      for (let i = 0; i < list_options.length; i++) {
        await db.query(
          'INSERT INTO attribute_list_options (attribute_id, option_value, sort_order) VALUES (?, ?, ?)',
          [req.params.attrId, list_options[i], i]
        );
      }
    }
  }
  res.json({ message: 'Updated' });
});

// Delete attribute
router.delete('/:typeId/attributes/:attrId', async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (userId) {
    const [users] = await db.query('SELECT asset_type_can_delete, profile_type FROM users WHERE id = ?', [userId]);
    if (users.length && users[0].profile_type !== 'super_admin' && !users[0].asset_type_can_delete)
      return res.status(403).json({ message: 'You do not have permission to delete asset types' });
  }
  // Remove all stored values for this attribute across all assets
  await db.query('DELETE FROM asset_attribute_values WHERE attribute_id = ?', [req.params.attrId]);
  // Remove list options
  await db.query('DELETE FROM attribute_list_options WHERE attribute_id = ?', [req.params.attrId]);
  // Remove the attribute definition
  await db.query('DELETE FROM asset_type_attributes WHERE id = ? AND asset_type_id = ?',
    [req.params.attrId, req.params.typeId]);
  res.json({ message: 'Deleted' });
});

module.exports = router;
