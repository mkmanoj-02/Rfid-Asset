const express = require('express');
const router = express.Router();
const db = require('../db');
const { runRules } = require('../ruleEngine');
const audit = require('../audit');

// Helper: parse privilege array from user record
function parsePriv(val) {
  if (!val) return null;
  if (Array.isArray(val)) return val.length ? val : null;
  try { const p = JSON.parse(val); return p && p.length ? p : null; } catch { return null; }
}

const ASSET_INVENTORY_STATUSES = ['in_inventory', 'missing', 'not_in_inventory'];

/** @returns {string} defaultVal when val omitted; null when invalid */
function normalizeAssetInventoryStatus(val, defaultVal = 'in_inventory') {
  if (val === undefined || val === null || val === '') return defaultVal;
  const s = String(val).trim().toLowerCase().replace(/-/g, '_');
  const aliases = {
    inventory: 'in_inventory',
    in_inventory: 'in_inventory',
    missing: 'missing',
    not_in_inventory: 'not_in_inventory',
    excluded: 'not_in_inventory',
    out_of_inventory: 'not_in_inventory',
  };
  const mapped = aliases[s] || (ASSET_INVENTORY_STATUSES.includes(s) ? s : null);
  return mapped || null;
}

function parseSinceQuery(since) {
  if (since === undefined || since === null || since === '') return null;
  const d = new Date(String(since));
  if (Number.isNaN(d.getTime())) return { error: 'Invalid since; use ISO 8601 datetime' };
  return { date: d };
}

// Helper: expand location IDs to include all sub-locations recursively
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

router.get('/', async (req, res, next) => {
  try {
  const { user_id, search, location_id, asset_type_id, page, limit, since, asset_inventory_status, sort: sortField, sort_dir } = req.query;

  // Pagination only applies when both page and limit are explicitly provided
  const paginate = page !== undefined && limit !== undefined;
  const pageNum  = Math.max(1, parseInt(page) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(limit)));
  const offset   = (pageNum - 1) * pageSize;

  let allowedTypeIds = null;
  let allowedLocationIds = null;

  let assetAttrFilters = null; // [{ attribute_id, value }]

  if (user_id) {
    const [users] = await db.query('SELECT asset_type_privileges, location_privileges, asset_privileges, profile_type FROM users WHERE id = ?', [user_id]);
    if (users.length && users[0].profile_type !== 'super_admin') {
      allowedTypeIds = parsePriv(users[0].asset_type_privileges);
      // Expand location privileges to include sub-locations
      const baseLocIds = parsePriv(users[0].location_privileges);
      allowedLocationIds = baseLocIds ? await expandWithSubLocations(baseLocIds) : null;
      // asset_privileges = attribute-based filter
      if (users[0].asset_privileges) {
        try {
          const ap = typeof users[0].asset_privileges === 'string'
            ? JSON.parse(users[0].asset_privileges)
            : users[0].asset_privileges;
          if (ap && ap.length) assetAttrFilters = ap;
        } catch {}
      }
    }
  }

  const baseJoin = `FROM assets a
    LEFT JOIN asset_types at ON a.asset_type_id = at.id
    LEFT JOIN locations l ON a.current_location_id = l.id
    LEFT JOIN tag_types tt ON a.tag_type_id = tt.id
    LEFT JOIN vendors v ON a.vendor_id = v.id`;

  let query = `SELECT a.*, at.name AS asset_type_name, l.name AS location_name, tt.name AS tag_type_name, v.name AS vendor_name ${baseJoin}`;
  const conditions = [];
  const params = [];

  if (allowedTypeIds) {
    conditions.push(`a.asset_type_id IN (${allowedTypeIds.map(() => '?').join(',')})`);
    params.push(...allowedTypeIds);
  }
  if (allowedLocationIds) {
    conditions.push(`a.current_location_id IN (${allowedLocationIds.map(() => '?').join(',')})`);
    params.push(...allowedLocationIds);
  }

  // Attribute-based filter: asset must have ALL specified attribute=value pairs
  // Match by attribute NAME (case-insensitive) not ID, since same-named attrs have different IDs per asset type
  if (assetAttrFilters && assetAttrFilters.length) {
    for (const f of assetAttrFilters) {
      conditions.push(`EXISTS (
        SELECT 1 FROM asset_attribute_values aav
        JOIN asset_type_attributes ata ON aav.attribute_id = ata.id
        WHERE aav.asset_id = a.id
          AND LOWER(ata.name) = LOWER(?)
          AND LOWER(aav.value) = LOWER(?)
      )`);
      params.push(f.attribute_name, f.value);
    }
  }

  // Filter by specific location
  if (location_id) {
    conditions.push('a.current_location_id = ?');
    params.push(location_id);
  }

  // Filter by specific asset type
  if (asset_type_id) {
    conditions.push('a.asset_type_id = ?');
    params.push(asset_type_id);
  }

  if (since !== undefined && since !== null && since !== '') {
    const parsed = parseSinceQuery(since);
    if (parsed.error) return res.status(400).json({ message: parsed.error });
    conditions.push('a.updated_at > ?');
    params.push(parsed.date);
  }

  if (asset_inventory_status !== undefined && asset_inventory_status !== null && asset_inventory_status !== '') {
    const st = normalizeAssetInventoryStatus(asset_inventory_status, 'in_inventory');
    if (!st) return res.status(400).json({
      message: `Invalid asset_inventory_status; use one of: ${ASSET_INVENTORY_STATUSES.join(', ')}`,
    });
    conditions.push('a.asset_inventory_status = ?');
    params.push(st);
  }

  // Search across serial, name, rfid, asset type name, location name, attribute values
  if (search && search.trim().length >= 2) {
    const s = `%${search.trim()}%`;
    conditions.push(`(
      a.asset_serial LIKE ? OR
      a.name LIKE ? OR
      a.rfid_tag LIKE ? OR
      at.name LIKE ? OR
      l.name LIKE ? OR
      EXISTS (
        SELECT 1 FROM asset_attribute_values aav2
        WHERE aav2.asset_id = a.id AND aav2.value LIKE ?
      )
    )`);
    params.push(s, s, s, s, s, s);
  }

  const whereClause = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';

  const SORT_MAP = {
    name: 'a.name',
    asset_serial: 'a.asset_serial',
    asset_type_name: 'at.name',
    location_name: 'l.name',
    created_at: 'a.created_at',
    asset_inventory_status: 'a.asset_inventory_status',
  };
  const sortCol = SORT_MAP[String(sortField || '').trim()] || 'a.created_at';
  const sortDirection = String(sort_dir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  query += whereClause + ` ORDER BY ${sortCol} ${sortDirection}, a.id DESC`;

  if (paginate) {
    // Total count (same filters, no LIMIT)
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total ${baseJoin}${whereClause}`,
      params
    );

    query += ' LIMIT ? OFFSET ?';
    const [rows] = await db.query(query, [...params, pageSize, offset]);

    return res.json({
      data: rows,
      pagination: {
        total,
        page:       pageNum,
        limit:      pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  }

  // No pagination — return all records as a plain array
  const [rows] = await db.query(query, params);
  res.json(rows);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ message: 'Invalid asset ID' });

  const [rows] = await db.query(`
    SELECT a.*, at.name AS asset_type_name, l.name AS location_name, tt.name AS tag_type_name, v.name AS vendor_name
    FROM assets a
    LEFT JOIN asset_types at ON a.asset_type_id = at.id
    LEFT JOIN locations l ON a.current_location_id = l.id
    LEFT JOIN tag_types tt ON a.tag_type_id = tt.id
    LEFT JOIN vendors v ON a.vendor_id = v.id
    WHERE a.id = ?
  `, [id]);
  if (!rows.length) return res.status(404).json({ message: 'Not found' });
  res.json(rows[0]);
  } catch (err) { next(err); }
});

// Get attribute values for an asset
router.get('/:id/attributes', async (req, res, next) => {
  try {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ message: 'Invalid asset ID' });

  const [rows] = await db.query(`
    SELECT aav.*, ata.name, ata.attr_type
    FROM asset_attribute_values aav
    JOIN asset_type_attributes ata ON aav.attribute_id = ata.id
    WHERE aav.asset_id = ?
  `, [id]);

  // Attach list options
  for (const row of rows) {
    if (row.attr_type === 'list') {
      const [opts] = await db.query(
        'SELECT * FROM attribute_list_options WHERE attribute_id = ? ORDER BY sort_order',
        [row.attribute_id]
      );
      row.list_options = opts;
    } else {
      row.list_options = [];
    }
  }
  res.json(rows);
  } catch (err) { next(err); }
});

// Save/update attribute values for an asset
router.put('/:id/attributes', async (req, res, next) => {
  try {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ message: 'Invalid asset ID' });

  const { values } = req.body; // [{ attribute_id, value }]
  for (const v of values) {
    await db.query(
      `INSERT INTO asset_attribute_values (asset_id, attribute_id, value)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE value = ?`,
      [id, v.attribute_id, v.value, v.value]
    );
  }
  // Trigger attribute/maintenance rules immediately
  setImmediate(() => runRules().catch(e => console.error('Rule engine error:', e.message)));
  await db.query('UPDATE assets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
  await audit.log('Asset', 'Modified', `Attributes updated for asset ID ${id}`, req.auditUser, req.auditUserId);
  res.json({ message: 'Saved' });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
  const { rfid_tag, tag_type_id, vendor_id, asset_serial, name, asset_type_id, current_location_id, status, description, asset_inventory_status } = req.body;

  // --- Mandatory field validation ---
  const errors = [];
  if (!name || !name.toString().trim()) errors.push('Asset name is required');
  if (!asset_serial || !asset_serial.toString().trim()) errors.push('Asset serial number is required');
  if (!asset_type_id) errors.push('Asset type is required');
  if (!current_location_id) errors.push('Location is required');
  if (!vendor_id) errors.push('Vendor is required');
  if (!tag_type_id) errors.push('Tag type is required');
  if (!status || !status.toString().trim()) errors.push('Status is required');
  if (rfid_tag && rfid_tag.toString().trim().length !== 24) errors.push('RFID tag must be exactly 24 characters');
  const invStatus = normalizeAssetInventoryStatus(asset_inventory_status, 'in_inventory');
  if (asset_inventory_status !== undefined && asset_inventory_status !== null && asset_inventory_status !== '' && !invStatus)
    errors.push(`asset_inventory_status must be one of: ${ASSET_INVENTORY_STATUSES.join(', ')}`);
  if (errors.length) return res.status(400).json({ message: errors.join('; ') });

  const locationId = current_location_id;

  const [result] = await db.query(
    'INSERT INTO assets (rfid_tag, tag_type_id, vendor_id, asset_serial, name, asset_type_id, current_location_id, status, description, asset_inventory_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [rfid_tag || null, tag_type_id || null, vendor_id || null, asset_serial, name, asset_type_id, locationId, status || 'active', description || null, invStatus]
  );
  const assetId = result.insertId;

  if (asset_type_id) {
    const [attrs] = await db.query('SELECT id FROM asset_type_attributes WHERE asset_type_id = ?', [asset_type_id]);
    for (const attr of attrs) {
      await db.query('INSERT IGNORE INTO asset_attribute_values (asset_id, attribute_id, value) VALUES (?, ?, NULL)', [assetId, attr.id]);
    }
  }

  await db.query(
    'INSERT INTO movement_history (asset_id, from_location_id, to_location_id, notes) VALUES (?, NULL, ?, ?)',
    [assetId, locationId, 'Initial placement']
  );
  // Trigger rule engine for is_added rules
  setImmediate(() => runRules().catch(e => console.error('Rule engine error:', e.message)));
  await audit.log('Asset', 'Added', `Asset "${name}" (Serial: ${asset_serial || 'N/A'}) was added`, req.auditUser, req.auditUserId);
  res.status(201).json({ id: assetId });
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ message: 'Invalid asset ID' });

  const { rfid_tag, tag_type_id, vendor_id, asset_serial, name, asset_type_id, current_location_id, status, description, asset_inventory_status } = req.body;

  // Check asset modify privilege
  const userId = req.headers['x-user-id'];
  if (userId) {
    const [users] = await db.query(
      'SELECT asset_can_modify, location_privileges, profile_type FROM users WHERE id = ?', [userId]
    );
    if (users.length && users[0].profile_type !== 'super_admin') {
      if (!users[0].asset_can_modify)
        return res.status(403).json({ message: 'You do not have permission to modify assets' });

      // If moving to a new location, check it is within the user's allowed locations
      if (current_location_id) {
        const baseLocIds = parsePriv(users[0].location_privileges);
        if (baseLocIds) {
          const allowedLocIds = await expandWithSubLocations(baseLocIds);
          if (!allowedLocIds.includes(Number(current_location_id)))
            return res.status(403).json({ message: 'You do not have permission to move assets to that location' });
        }
      }
    }
  }

  // --- Mandatory field validation ---
  const editErrors = [];
  if (!name || !name.toString().trim()) editErrors.push('Asset name is required');
  if (!asset_serial || !asset_serial.toString().trim()) editErrors.push('Asset serial number is required');
  if (!asset_type_id) editErrors.push('Asset type is required');
  if (!current_location_id) editErrors.push('Location is required');
  if (!vendor_id) editErrors.push('Vendor is required');
  if (!tag_type_id) editErrors.push('Tag type is required');
  if (!status || !status.toString().trim()) editErrors.push('Status is required');
  if (rfid_tag && rfid_tag.toString().trim().length !== 24) editErrors.push('RFID tag must be exactly 24 characters');
  if (asset_inventory_status !== undefined && asset_inventory_status !== null && asset_inventory_status !== '') {
    const st = normalizeAssetInventoryStatus(asset_inventory_status, 'in_inventory');
    if (!st) editErrors.push(`asset_inventory_status must be one of: ${ASSET_INVENTORY_STATUSES.join(', ')}`);
  }
  if (editErrors.length) return res.status(400).json({ message: editErrors.join('; ') });

  const [existing] = await db.query(
    'SELECT current_location_id, asset_inventory_status FROM assets WHERE id = ?',
    [id]
  );
  if (!existing.length) return res.status(404).json({ message: 'Not found' });

  const invStatus =
    asset_inventory_status !== undefined && asset_inventory_status !== null && asset_inventory_status !== ''
      ? normalizeAssetInventoryStatus(asset_inventory_status, 'in_inventory')
      : existing[0].asset_inventory_status || 'in_inventory';

  await db.query(
    'UPDATE assets SET rfid_tag = ?, tag_type_id = ?, vendor_id = ?, asset_serial = ?, name = ?, asset_type_id = ?, current_location_id = ?, status = ?, description = ?, asset_inventory_status = ? WHERE id = ?',
    [rfid_tag || null, tag_type_id || null, vendor_id || null, asset_serial, name, asset_type_id, current_location_id || null, status, description || null, invStatus, id]
  );

  const oldLocation = existing[0].current_location_id;
  if (current_location_id && current_location_id != oldLocation) {
    await db.query(
      'INSERT INTO movement_history (asset_id, from_location_id, to_location_id, notes) VALUES (?, ?, ?, ?)',
      [id, oldLocation, current_location_id, req.body.notes || null]
    );
    // Trigger rule engine immediately for real-time alerts
    setImmediate(() => runRules().catch(e => console.error('Rule engine error:', e.message)));
  }
  await audit.log('Asset', 'Modified', `Asset ID ${id} was updated`, req.auditUser, req.auditUserId);
  res.json({ message: 'Updated' });
  } catch (err) { next(err); }
});

router.delete('/bulk', async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length)
      return res.status(400).json({ message: 'ids array is required' });

    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await db.query(`SELECT name, asset_serial FROM assets WHERE id IN (${placeholders})`, ids);
    await db.query(`DELETE FROM assets WHERE id IN (${placeholders})`, ids);

    for (const row of rows)
      await audit.log('Asset', 'Deleted', `Asset "${row.name}" (Serial: ${row.asset_serial || 'N/A'}) was deleted`, req.auditUser, req.auditUserId);

    res.json({ message: `${rows.length} asset(s) deleted` });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ message: 'Invalid asset ID' });

  const [rows] = await db.query('SELECT name, asset_serial FROM assets WHERE id = ?', [id]);
  if (!rows.length) return res.status(404).json({ message: 'Asset not found' });

  await db.query('DELETE FROM assets WHERE id = ?', [id]);
  await audit.log('Asset', 'Deleted', `Asset "${rows[0].name}" (Serial: ${rows[0].asset_serial || 'N/A'}) was deleted`, req.auditUser, req.auditUserId);
  res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
