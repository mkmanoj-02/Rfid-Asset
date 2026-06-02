const express = require('express');
const router = express.Router();
const db = require('../db');
const { runRules } = require('../ruleEngine');
const { shouldLogRfidTagMovement, insertRfidTagMovement } = require('../lib/rfidMovements');
const audit = require('../audit');
const resourceImages = require('../controllers/resourceImages');
const { uploadImageMiddleware, handleMulterImageError } = require('../helper/upload');
const { optionalImageUpload } = require('../middleware/optionalImageUpload');
const {
  resolveAssetImageOnCreate,
  resolveAssetImageOnUpdate,
  cleanupAssetImageOnDelete,
  safeUnlinkCustomAssetFile,
  truthyFormFlag,
} = require('../controllers/imageInheritance');
const {
  assertModify,
  assertDelete,
  assertAssetPayload,
  assertAssetInScope,
  scopeAssetWhere,
} = require('../lib/userAuthz');
const { requireModify, requireDelete } = require('../middleware/requireAuthz');
const { withTransaction } = require('../lib/importHelpers');
const fs = require('fs').promises;

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

async function loadListOptionsByAttributeIds(attributeIds) {
  const map = new Map();
  if (!attributeIds.length) return map;
  const ph = attributeIds.map(() => '?').join(',');
  const [opts] = await db.query(
    `SELECT * FROM attribute_list_options WHERE attribute_id IN (${ph}) ORDER BY attribute_id, sort_order, id`,
    attributeIds
  );
  for (const o of opts) {
    if (!map.has(o.attribute_id)) map.set(o.attribute_id, []);
    map.get(o.attribute_id).push(o);
  }
  return map;
}

/** Adds `attributes` to each row (same shape as GET /api/assets/:id/attributes). */
async function attachAssetAttributeValues(assetRows) {
  if (!assetRows.length) return;
  const ids = [...new Set(assetRows.map((r) => r.id).filter((id) => id != null))];
  if (!ids.length) return;
  const ph = ids.map(() => '?').join(',');
  const [values] = await db.query(
    `SELECT aav.*, ata.name, ata.attr_type
     FROM asset_attribute_values aav
     JOIN asset_type_attributes ata ON aav.attribute_id = ata.id
     WHERE aav.asset_id IN (${ph})
     ORDER BY ata.sort_order ASC, ata.id ASC`,
    ids
  );
  const listAttrIds = [...new Set(values.filter((v) => v.attr_type === 'list').map((v) => v.attribute_id))];
  const optionsByAttrId = await loadListOptionsByAttributeIds(listAttrIds);
  const byAsset = new Map(ids.map((id) => [id, []]));
  for (const row of values) {
    const entry = { ...row };
    entry.list_options =
      row.attr_type === 'list' ? optionsByAttrId.get(row.attribute_id) || [] : [];
    byAsset.get(row.asset_id).push(entry);
  }
  for (const a of assetRows) {
    a.attributes = byAsset.get(a.id) || [];
  }
}

router.get('/', async (req, res, next) => {
  try {
  const { user_id, search, location_id, asset_type_id, page, limit, since, asset_inventory_status, sort: sortField, sort_dir } = req.query;

  // Pagination only applies when both page and limit are explicitly provided
  const paginate = page !== undefined && limit !== undefined;
  const pageNum  = Math.max(1, parseInt(page) || 1);
  const pageSize = Math.min(500, Math.max(1, parseInt(limit)));
  const offset   = (pageNum - 1) * pageSize;

  const authz = req.authz;
  const allowedTypeIds = authz?.typeIds ?? null;
  const allowedLocationIds = authz?.locationIds ?? null;
  const assetAttrFilters = authz?.attrFilters ?? null;

  const baseJoin = `FROM assets a
    LEFT JOIN asset_types at ON a.asset_type_id = at.id
    LEFT JOIN locations l ON a.current_location_id = l.id
    LEFT JOIN tag_types tt ON a.tag_type_id = tt.id
    LEFT JOIN vendors v ON a.vendor_id = v.id`;

  const lastSeenSubquery = `(SELECT MAX(mh.moved_at) FROM movement_history mh WHERE mh.asset_id = a.id)`;

  let query = `SELECT a.*, at.name AS asset_type_name, l.name AS location_name, tt.name AS tag_type_name, v.name AS vendor_name,
    ${lastSeenSubquery} AS lastseen ${baseJoin}`;
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
    lastseen: lastSeenSubquery,
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

    await attachAssetAttributeValues(rows);

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
  await attachAssetAttributeValues(rows);
  res.json(rows);
  } catch (err) { next(err); }
});

/** Lightweight list for dropdowns: id, name, rfid_tag (respects user asset scope). */
router.get('/dropdown', async (req, res, next) => {
  try {
    const { search, location_id, asset_type_id, limit } = req.query;
    const maxLimit = Math.min(2000, Math.max(1, parseInt(limit, 10) || 500));

    const extraConditions = [];
    const extraParams = [];

    if (location_id !== undefined && location_id !== '') {
      const locId = parseInt(location_id, 10);
      if (Number.isNaN(locId)) {
        return res.status(400).json({ message: 'Invalid location_id' });
      }
      extraConditions.push('a.current_location_id = ?');
      extraParams.push(locId);
    }

    if (asset_type_id !== undefined && asset_type_id !== '') {
      const typeId = parseInt(asset_type_id, 10);
      if (Number.isNaN(typeId)) {
        return res.status(400).json({ message: 'Invalid asset_type_id' });
      }
      extraConditions.push('a.asset_type_id = ?');
      extraParams.push(typeId);
    }

    const searchTerm = search != null ? String(search).trim() : '';
    if (searchTerm) {
      const s = `%${searchTerm}%`;
      extraConditions.push(
        '(a.name LIKE ? OR a.asset_serial LIKE ? OR a.rfid_tag LIKE ?)'
      );
      extraParams.push(s, s, s);
    }

    const scoped = scopeAssetWhere(req.authz, 'a', extraConditions, extraParams);
    const whereSql = scoped.sql || 'WHERE 1=1';

    const [rows] = await db.query(
      `SELECT a.id, a.name, a.rfid_tag
       FROM assets a
       ${whereSql}
       ORDER BY a.name ASC, a.id ASC
       LIMIT ?`,
      [...scoped.params, maxLimit]
    );

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// --- Image: multipart field "image" (jpg, jpeg, png, webp; max 5MB) ---
router.post(
  '/:id/image',
  requireModify('asset'),
  uploadImageMiddleware('assets'),
  handleMulterImageError,
  resourceImages.upload('assets')
);
router.delete('/:id/image', requireModify('asset'), resourceImages.remove('assets'));

router.get('/:id', async (req, res, next) => {
  try {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ message: 'Invalid asset ID' });

  const scopeErr = await assertAssetInScope(req.authz, res, id);
  if (scopeErr) return scopeErr;

  const [rows] = await db.query(`
    SELECT a.*, at.name AS asset_type_name, l.name AS location_name, tt.name AS tag_type_name, v.name AS vendor_name,
      (SELECT MAX(mh.moved_at) FROM movement_history mh WHERE mh.asset_id = a.id) AS lastseen
    FROM assets a
    LEFT JOIN asset_types at ON a.asset_type_id = at.id
    LEFT JOIN locations l ON a.current_location_id = l.id
    LEFT JOIN tag_types tt ON a.tag_type_id = tt.id
    LEFT JOIN vendors v ON a.vendor_id = v.id
    WHERE a.id = ?
  `, [id]);
  if (!rows.length) return res.status(404).json({ message: 'Not found' });
  await attachAssetAttributeValues(rows);
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
router.put('/:id/attributes', requireModify('asset'), async (req, res, next) => {
  try {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ message: 'Invalid asset ID' });

  const scopeErr = await assertAssetInScope(req.authz, res, id);
  if (scopeErr) return scopeErr;

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

router.post('/', requireModify('asset'), optionalImageUpload('assets'), async (req, res, next) => {
  try {
  const { rfid_tag, tag_type_id, vendor_id, asset_serial, name, asset_type_id, current_location_id, status, description, asset_inventory_status } = req.body;

  const payloadErr = assertAssetPayload(req.authz, res, { asset_type_id, current_location_id });
  if (payloadErr) return payloadErr;

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
  if (errors.length) {
    if (req.file?.path) {
      try { await require('fs').promises.unlink(req.file.path); } catch {}
    }
    return res.status(400).json({ message: errors.join('; ') });
  }

  const locationId = current_location_id;

  let imageUrl;
  let isCustom;
  try {
    const resolved = await resolveAssetImageOnCreate(asset_type_id, req.file || null);
    imageUrl = resolved.imageUrl;
    isCustom = resolved.isCustom;
  } catch (imgErr) {
    if (req.file?.path) {
      try { await require('fs').promises.unlink(req.file.path); } catch {}
    }
    return next(imgErr);
  }

  let assetId;
  try {
    assetId = await withTransaction(db, async (conn) => {
      const [result] = await conn.query(
        `INSERT INTO assets (rfid_tag, tag_type_id, vendor_id, asset_serial, name, asset_type_id,
          current_location_id, status, description, asset_inventory_status, image_url, is_custom_image)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          rfid_tag || null, tag_type_id || null, vendor_id || null, asset_serial, name, asset_type_id,
          locationId, status || 'active', description || null, invStatus, imageUrl, isCustom,
        ]
      );
      const id = result.insertId;

      if (asset_type_id) {
        const [attrs] = await conn.query(
          'SELECT id FROM asset_type_attributes WHERE asset_type_id = ?',
          [asset_type_id]
        );
        for (const attr of attrs) {
          await conn.query(
            'INSERT IGNORE INTO asset_attribute_values (asset_id, attribute_id, value) VALUES (?, ?, NULL)',
            [id, attr.id]
          );
        }
      }

      await conn.query(
        'INSERT INTO movement_history (asset_id, from_location_id, to_location_id, notes) VALUES (?, ?, NULL, ?)',
        [id, locationId, 'Initial placement']
      );

      if (shouldLogRfidTagMovement(null, rfid_tag)) {
        await insertRfidTagMovement(conn, id, locationId);
      }

      return id;
    });
  } catch (txErr) {
    if (req.file?.path) {
      try { await fs.unlink(req.file.path); } catch {}
    }
    throw txErr;
  }

  setImmediate(() => runRules().catch(e => console.error('Rule engine error:', e.message)));
  await audit.log('Asset', 'Added', `Asset "${name}" (Serial: ${asset_serial || 'N/A'}) was added`, req.auditUser, req.auditUserId);
  res.status(201).json({ id: assetId, image_url: imageUrl, is_custom_image: isCustom });
  } catch (err) { next(err); }
});

router.put('/:id', requireModify('asset'), optionalImageUpload('assets'), async (req, res, next) => {
  try {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ message: 'Invalid asset ID' });

  const scopeErr = await assertAssetInScope(req.authz, res, id);
  if (scopeErr) return scopeErr;

  const { rfid_tag, tag_type_id, vendor_id, asset_serial, name, asset_type_id, current_location_id, status, description, asset_inventory_status } = req.body;

  const payloadErr = assertAssetPayload(req.authz, res, { asset_type_id, current_location_id });
  if (payloadErr) return payloadErr;

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
    'SELECT current_location_id, rfid_tag, asset_inventory_status, image_url, is_custom_image, asset_type_id FROM assets WHERE id = ?',
    [id]
  );
  if (!existing.length) return res.status(404).json({ message: 'Not found' });

  const invStatus =
    asset_inventory_status !== undefined && asset_inventory_status !== null && asset_inventory_status !== ''
      ? normalizeAssetInventoryStatus(asset_inventory_status, 'in_inventory')
      : existing[0].asset_inventory_status || 'in_inventory';

  const imagePatch = await resolveAssetImageOnUpdate({
    existing: existing[0],
    file: req.file || null,
    removeCustomImage: truthyFormFlag(req.body.remove_custom_image),
    newAssetTypeId: asset_type_id,
  });

  await db.query(
    `UPDATE assets SET rfid_tag = ?, tag_type_id = ?, vendor_id = ?, asset_serial = ?, name = ?,
      asset_type_id = ?, current_location_id = ?, status = ?, description = ?, asset_inventory_status = ?,
      image_url = ?, is_custom_image = ? WHERE id = ?`,
    [
      rfid_tag || null, tag_type_id || null, vendor_id || null, asset_serial, name, asset_type_id,
      current_location_id || null, status, description || null, invStatus,
      imagePatch.imageUrl, imagePatch.isCustom, id,
    ]
  );

  const oldLocation = existing[0].current_location_id;
  const locId = current_location_id || oldLocation;
  if (current_location_id && current_location_id != oldLocation) {
    await db.query(
      'INSERT INTO movement_history (asset_id, from_location_id, to_location_id, notes) VALUES (?, ?, ?, ?)',
      [id, oldLocation, current_location_id, req.body.notes || null]
    );
    // Trigger rule engine immediately for real-time alerts
    setImmediate(() => runRules().catch(e => console.error('Rule engine error:', e.message)));
  }
  if (shouldLogRfidTagMovement(existing[0].rfid_tag, rfid_tag) && locId) {
    await insertRfidTagMovement(db, id, locId);
  }
  await audit.log('Asset', 'Modified', `Asset ID ${id} was updated`, req.auditUser, req.auditUserId);
  res.json({
    message: 'Updated',
    image_url: imagePatch.imageUrl,
    is_custom_image: imagePatch.isCustom,
  });
  } catch (err) { next(err); }
});

router.delete('/bulk', requireDelete('asset'), async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length)
      return res.status(400).json({ message: 'ids array is required' });

    for (const rawId of ids) {
      const scopeErr = await assertAssetInScope(req.authz, res, rawId);
      if (scopeErr) return scopeErr;
    }

    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await db.query(`SELECT name, asset_serial FROM assets WHERE id IN (${placeholders})`, ids);
    await db.query(`DELETE FROM assets WHERE id IN (${placeholders})`, ids);

    for (const row of rows)
      await audit.log('Asset', 'Deleted', `Asset "${row.name}" (Serial: ${row.asset_serial || 'N/A'}) was deleted`, req.auditUser, req.auditUserId);

    res.json({ message: `${rows.length} asset(s) deleted` });
  } catch (err) { next(err); }
});

router.delete('/:id', requireDelete('asset'), async (req, res, next) => {
  try {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ message: 'Invalid asset ID' });

  const scopeErr = await assertAssetInScope(req.authz, res, id);
  if (scopeErr) return scopeErr;

  const [rows] = await db.query(
    'SELECT name, asset_serial, image_url, is_custom_image FROM assets WHERE id = ?',
    [id]
  );
  if (!rows.length) return res.status(404).json({ message: 'Asset not found' });

  await cleanupAssetImageOnDelete(rows[0]);
  await db.query('DELETE FROM assets WHERE id = ?', [id]);
  await audit.log('Asset', 'Deleted', `Asset "${rows[0].name}" (Serial: ${rows[0].asset_serial || 'N/A'}) was deleted`, req.auditUser, req.auditUserId);
  res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
