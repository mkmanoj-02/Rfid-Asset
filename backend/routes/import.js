const express = require('express');
const router = express.Router();
const db = require('../db');
const audit = require('../audit');

const VALID_ASSET_STATUSES = new Set(['active', 'inactive', 'maintenance']);

// Helper: exact case-insensitive match only.
function findBestMatch(name, list) {
  if (!name) return null;
  const lower = name.trim().toLowerCase();
  return list.find(i => i.name.toLowerCase() === lower) || null;
}

function normalizeStatus(raw) {
  const s = (raw || 'active').toString().trim().toLowerCase();
  return VALID_ASSET_STATUSES.has(s) ? s : null;
}

/** Resolve master id from numeric id field or name field on import row. */
function resolveMasterId(row, idKey, nameKey, list, label) {
  const idRaw = row[idKey];
  if (idRaw != null && idRaw !== '') {
    const id = Number(idRaw);
    if (!Number.isNaN(id)) {
      const hit = list.find(x => x.id === id);
      if (hit) return { id: hit.id, fix: null, error: null };
      return { id: null, fix: null, error: `${label} id ${id} not found` };
    }
  }
  const name = (row[nameKey] || '').trim();
  if (!name) return { id: null, fix: null, error: null };
  const match = findBestMatch(name, list);
  if (!match) return { id: null, fix: null, error: `${label} "${name}" not found` };
  const fix = match.name.toLowerCase() !== name.toLowerCase() ? match.name : null;
  return { id: match.id, fix, error: null };
}

function normalizeAssetImportRow(row) {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    asset_serial: (row.asset_serial || '').trim(),
    name: (row.name || '').trim(),
    rfid_tag: (row.rfid_tag || '').trim(),
    asset_type: (row.asset_type || '').trim(),
    location: (row.location || '').trim(),
    tag_type: (row.tag_type || '').trim(),
    vendor: (row.vendor || '').trim(),
    status: (row.status || '').trim(),
    description: (row.description || '').trim(),
  };
}

function collectMissingNames(rows, nameKey, list) {
  const missing = new Set();
  rows.forEach(row => {
    const normalized = normalizeAssetImportRow(row);
    const name = (normalized[nameKey] || '').trim();
    if (!name) return;
    if (!findBestMatch(name, list)) missing.add(name);
  });
  return [...missing];
}

async function loadTagTypeByName(name) {
  const [rows] = await db.query('SELECT id, name FROM tag_types WHERE LOWER(name) = LOWER(?) LIMIT 1', [name]);
  return rows[0] || null;
}

async function loadVendorByName(name) {
  const [rows] = await db.query('SELECT id, name FROM vendors WHERE LOWER(name) = LOWER(?) LIMIT 1', [name]);
  return rows[0] || null;
}

async function ensureTagType(name, tagTypes, created) {
  const trimmed = (name || '').trim();
  if (!trimmed) return null;
  const existing = findBestMatch(trimmed, tagTypes);
  if (existing) return existing;
  if (created.has(trimmed.toLowerCase())) return findBestMatch(trimmed, tagTypes);

  try {
    const [result] = await db.query(
      'INSERT INTO tag_types (name, description) VALUES (?, ?)',
      [trimmed, 'Created via import']
    );
    const entry = { id: result.insertId, name: trimmed };
    tagTypes.push(entry);
    created.add(trimmed.toLowerCase());
    return entry;
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      const row = await loadTagTypeByName(trimmed);
      if (row) {
        tagTypes.push(row);
        created.add(trimmed.toLowerCase());
        return row;
      }
    }
    throw e;
  }
}

async function ensureVendor(name, vendors, created) {
  const trimmed = (name || '').trim();
  if (!trimmed) return null;
  const existing = findBestMatch(trimmed, vendors);
  if (existing) return existing;
  if (created.has(trimmed.toLowerCase())) return findBestMatch(trimmed, vendors);

  try {
    const [result] = await db.query('INSERT INTO vendors (name) VALUES (?)', [trimmed]);
    const entry = { id: result.insertId, name: trimmed };
    vendors.push(entry);
    created.add(trimmed.toLowerCase());
    return entry;
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      const row = await loadVendorByName(trimmed);
      if (row) {
        vendors.push(row);
        created.add(trimmed.toLowerCase());
        return row;
      }
    }
    throw e;
  }
}

async function ensureTypeAttributes(typeId, row) {
  if (!typeId || !row.attributes || !row.attrTypes) return;
  for (const [attrName, attrType] of Object.entries(row.attrTypes)) {
    await db.query(
      'INSERT IGNORE INTO asset_type_attributes (asset_type_id, name, attr_type) VALUES (?,?,?)',
      [typeId, attrName, attrType || 'string']
    );
  }
}

function validateAssetImportRow(row, ctx) {
  const { assetTypes, locations, tagTypes, vendors, existingAssets } = ctx;
  const errors = [];

  const serial = (row.asset_serial || '').trim();
  const name = (row.name || '').trim();
  if (!serial) errors.push('Asset Serial is required');
  if (!name) errors.push('Asset Name is required');

  let typeMatch = null;
  let typeFix = null;
  if (!row.asset_type?.trim()) {
    errors.push('Asset Type is required');
  } else {
    typeMatch = findBestMatch(row.asset_type, assetTypes);
    if (!typeMatch) errors.push(`Asset type "${row.asset_type}" not found`);
    else if (typeMatch.name.toLowerCase() !== row.asset_type.trim().toLowerCase()) {
      typeFix = typeMatch.name;
    }
  }

  let locationMatch = null;
  let locationFix = null;
  if (!row.location?.trim()) {
    errors.push('Location is required');
  } else {
    locationMatch = findBestMatch(row.location, locations);
    if (!locationMatch) errors.push(`Location "${row.location}" not found`);
    else if (locationMatch.name.toLowerCase() !== row.location.trim().toLowerCase()) {
      locationFix = locationMatch.name;
    }
  }

  const hasTagInput = row.tag_type?.trim() || (row.tag_type_id != null && row.tag_type_id !== '');
  const tagRes = resolveMasterId(row, 'tag_type_id', 'tag_type', tagTypes, 'Tag type');
  if (!hasTagInput) errors.push('Tag Type is required');
  else if (tagRes.error) errors.push(tagRes.error);

  const hasVendorInput = row.vendor?.trim() || (row.vendor_id != null && row.vendor_id !== '');
  const vendorRes = resolveMasterId(row, 'vendor_id', 'vendor', vendors, 'Vendor');
  if (!hasVendorInput) errors.push('Vendor is required');
  else if (vendorRes.error) errors.push(vendorRes.error);

  let status = 'active';
  if (row.status != null && String(row.status).trim() !== '') {
    const normalized = normalizeStatus(row.status);
    if (!normalized) errors.push('Status must be active, inactive, or maintenance');
    else status = normalized;
  }

  const existingMatch = serial ? existingAssets.find(a => a.asset_serial === serial) : null;

  return {
    ...row,
    name: name || row.name,
    asset_serial: serial || row.asset_serial,
    tag_type_id: tagRes.id,
    vendor_id: vendorRes.id,
    status,
    _status: errors.length ? 'error' : existingMatch ? 'update' : 'insert',
    _errors: errors,
    _typeFix: typeFix,
    _locationFix: locationFix,
    _tagTypeFix: tagRes.fix,
    _vendorFix: vendorRes.fix,
    _typeId: typeMatch ? typeMatch.id : null,
    _locationId: locationMatch ? locationMatch.id : null,
    _existingId: existingMatch ? existingMatch.id : null,
  };
}

// Preview + validate locations
router.post('/locations/preview', async (req, res) => {
  const { rows } = req.body;
  const [existing] = await db.query('SELECT id, name FROM locations');

  const result = rows.map(row => {
    const name = (row.name || '').trim();
    const parentName = (row.parent_name || '').trim();
    const errors = [];

    if (!name) errors.push('Location name is required');

    let parentMatch = null;
    let parentFix = null;
    if (parentName) {
      parentMatch = findBestMatch(parentName, existing);
      if (!parentMatch) errors.push(`Parent location "${parentName}" not found`);
      else if (parentMatch.name.toLowerCase() !== parentName.toLowerCase()) parentFix = parentMatch.name;
    }

    const existingMatch = existing.find(e => e.name.toLowerCase() === name.toLowerCase());

    return {
      ...row,
      _status: errors.length ? 'error' : existingMatch ? 'update' : 'insert',
      _errors: errors,
      _parentFix: parentFix,
      _existingId: existingMatch ? existingMatch.id : null,
      _parentId: parentMatch ? parentMatch.id : null,
    };
  });

  res.json(result);
});

router.post('/locations/execute', async (req, res) => {
  const { rows } = req.body;
  let inserted = 0, updated = 0, skipped = 0, errors = 0;

  for (const row of rows) {
    if (row._status === 'error') { errors++; continue; }
    try {
      if (row._status === 'update') {
        await db.query('UPDATE locations SET description=?, parent_id=? WHERE id=?',
          [row.description || null, row._parentId || null, row._existingId]);
        updated++;
      } else {
        await db.query('INSERT INTO locations (name, description, parent_id) VALUES (?,?,?)',
          [row.name, row.description || null, row._parentId || null]);
        inserted++;
      }
    } catch (e) { errors++; }
  }
  await audit.log('Import', 'Import', `Locations imported: ${inserted} inserted, ${updated} updated, ${errors} errors`, req.auditUser, req.auditUserId);
  res.json({ inserted, updated, skipped, errors });
});

router.post('/asset-types/preview', async (req, res) => {
  const { rows } = req.body;
  const [existing] = await db.query('SELECT id, name FROM asset_types');
  const workingList = [...existing];

  const result = rows.map(row => {
    const name = (row.name || '').trim();
    const errors = [];
    if (!name) errors.push('Asset type name is required');

    const existingMatch = workingList.find(e => e.name.toLowerCase() === name.toLowerCase());

    let parentMatch = null, parentFix = null;
    if (row.parent_name && row.parent_name.trim()) {
      parentMatch = findBestMatch(row.parent_name.trim(), workingList);
      if (!parentMatch) errors.push(`Parent type "${row.parent_name}" not found`);
      else if (parentMatch.name.toLowerCase() !== row.parent_name.trim().toLowerCase()) parentFix = parentMatch.name;
    }

    if (!existingMatch && name) {
      workingList.push({ id: `_new_${name}`, name });
    }

    return {
      ...row,
      _status: errors.length ? 'error' : existingMatch ? 'update' : 'insert',
      _errors: errors,
      _parentFix: parentFix,
      _parentId: parentMatch ? parentMatch.id : null,
      _existingId: existingMatch ? existingMatch.id : null,
    };
  });

  res.json(result);
});

router.post('/asset-types/execute', async (req, res) => {
  const { rows } = req.body;
  let inserted = 0, updated = 0, errors = 0;
  const nameToId = {};
  const [existingTypes] = await db.query('SELECT id, name FROM asset_types');
  existingTypes.forEach(t => { nameToId[t.name.toLowerCase()] = t.id; });

  for (const row of rows) {
    if (row._status === 'error') { errors++; continue; }
    try {
      let parentId = null;
      if (row.parent_name && row.parent_name.trim()) {
        const key = row.parent_name.trim().toLowerCase();
        parentId = nameToId[key] || null;
      }

      if (row._status === 'update') {
        await db.query(
          'UPDATE asset_types SET description=?, parent_id=? WHERE id=?',
          [row.description || null, parentId, row._existingId]
        );
        updated++;
      } else {
        const [result] = await db.query(
          'INSERT INTO asset_types (name, description, parent_id) VALUES (?,?,?)',
          [row.name, row.description || null, parentId]
        );
        nameToId[row.name.toLowerCase()] = result.insertId;

        if (row.attributes && row.attributes.length) {
          for (const attr of row.attributes) {
            await db.query('INSERT INTO asset_type_attributes (asset_type_id, name, attr_type) VALUES (?,?,?)',
              [result.insertId, attr.name, attr.type || 'string']);
          }
        }
        inserted++;
      }
    } catch (e) { errors++; }
  }
  await audit.log('Import', 'Import', `Asset types imported: ${inserted} inserted, ${updated} updated, ${errors} errors`, req.auditUser, req.auditUserId);
  res.json({ inserted, updated, errors });
});

// Check missing masters before preview (drives Smart Fix dialog)
router.post('/assets/check', async (req, res) => {
  const rows = (req.body.rows || []).map(normalizeAssetImportRow);
  const [assetTypes] = await db.query('SELECT id, name FROM asset_types');
  const [locations] = await db.query('SELECT id, name FROM locations');
  const [tagTypes] = await db.query('SELECT id, name FROM tag_types');
  const [vendors] = await db.query('SELECT id, name FROM vendors');

  res.json({
    missingTypes: collectMissingNames(rows, 'asset_type', assetTypes),
    missingLocations: collectMissingNames(rows, 'location', locations),
    missingTagTypes: collectMissingNames(rows, 'tag_type', tagTypes),
    missingVendors: collectMissingNames(rows, 'vendor', vendors),
  });
});

// Smart fix: auto-create missing asset types, locations, tag types, and vendors
router.post('/assets/smartfix', async (req, res) => {
  const rows = (req.body.rows || []).map(normalizeAssetImportRow);
  const [assetTypes] = await db.query('SELECT id, name FROM asset_types');
  const [locations] = await db.query('SELECT id, name FROM locations');
  const [tagTypes] = await db.query('SELECT id, name FROM tag_types');
  const [vendors] = await db.query('SELECT id, name FROM vendors');

  const createdTypes = new Set();
  const createdLocations = new Set();
  const createdTagTypes = new Set();
  const createdVendors = new Set();
  const createdTagTypeNames = [];
  const createdVendorNames = [];

  for (const row of rows) {
    if (row.asset_type?.trim()) {
      let typeMatch = findBestMatch(row.asset_type, assetTypes);
      if (!typeMatch && !createdTypes.has(row.asset_type.trim())) {
        const [result] = await db.query('INSERT INTO asset_types (name) VALUES (?)', [row.asset_type.trim()]);
        typeMatch = { id: result.insertId, name: row.asset_type.trim() };
        assetTypes.push(typeMatch);
        createdTypes.add(row.asset_type.trim());
      }
      if (typeMatch) await ensureTypeAttributes(typeMatch.id, row);
    }

    if (row.location?.trim()) {
      const match = findBestMatch(row.location, locations);
      if (!match && !createdLocations.has(row.location.trim())) {
        const [result] = await db.query('INSERT INTO locations (name) VALUES (?)', [row.location.trim()]);
        locations.push({ id: result.insertId, name: row.location.trim() });
        createdLocations.add(row.location.trim());
      }
    }

    if (row.tag_type?.trim()) {
      const before = findBestMatch(row.tag_type, tagTypes);
      const entry = await ensureTagType(row.tag_type, tagTypes, createdTagTypes);
      if (!before && entry && !createdTagTypeNames.includes(entry.name)) {
        createdTagTypeNames.push(entry.name);
      }
    }

    if (row.vendor?.trim()) {
      const before = findBestMatch(row.vendor, vendors);
      const entry = await ensureVendor(row.vendor, vendors, createdVendors);
      if (!before && entry && !createdVendorNames.includes(entry.name)) {
        createdVendorNames.push(entry.name);
      }
    }
  }

  res.json({
    createdTypes: [...createdTypes],
    createdLocations: [...createdLocations],
    createdTagTypes: createdTagTypeNames,
    createdVendors: createdVendorNames,
  });
});

router.post('/assets/preview', async (req, res) => {
  const rows = (req.body.rows || []).map(normalizeAssetImportRow);
  const [existingAssets] = await db.query('SELECT id, asset_serial FROM assets');
  const [assetTypes] = await db.query('SELECT id, name FROM asset_types');
  const [locations] = await db.query('SELECT id, name FROM locations');
  const [tagTypes] = await db.query('SELECT id, name FROM tag_types');
  const [vendors] = await db.query('SELECT id, name FROM vendors');

  const ctx = { assetTypes, locations, tagTypes, vendors, existingAssets };
  const result = rows.map(row => validateAssetImportRow(row, ctx));
  res.json(result);
});

router.post('/assets/execute', async (req, res) => {
  const rows = (req.body.rows || []).map(normalizeAssetImportRow);
  let inserted = 0, updated = 0, errors = 0;

  const [allTypeAttrs] = await db.query('SELECT id, asset_type_id, name, attr_type FROM asset_type_attributes');
  const attrCache = {};
  allTypeAttrs.forEach(a => {
    if (!attrCache[a.asset_type_id]) attrCache[a.asset_type_id] = [];
    attrCache[a.asset_type_id].push(a);
  });

  const ensureAttr = async (typeId, attrName, attrType) => {
    if (!attrCache[typeId]) attrCache[typeId] = [];
    let attr = attrCache[typeId].find(a => a.name.toLowerCase() === attrName.toLowerCase());
    if (!attr) {
      const [ar] = await db.query(
        'INSERT INTO asset_type_attributes (asset_type_id, name, attr_type) VALUES (?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)',
        [typeId, attrName, attrType || 'string']
      );
      const attrId = ar.insertId;
      attr = { id: attrId, name: attrName };
      attrCache[typeId].push(attr);
    }
    return attr.id;
  };

  for (const row of rows) {
    if (row._status === 'error') { errors++; continue; }

    const locationId = row._locationId;
    const typeId = row._typeId;
    const tagTypeId = row.tag_type_id;
    const vendorId = row.vendor_id;
    const status = row.status || 'active';

    if (!locationId || !typeId || !tagTypeId || !vendorId) {
      console.error('Import row missing resolved ids:', {
        asset_serial: row.asset_serial,
        locationId,
        typeId,
        tagTypeId,
        vendorId,
      });
      errors++;
      continue;
    }

    try {
      if (row._status === 'update') {
        await db.query(
          `UPDATE assets SET name=?, rfid_tag=?, tag_type_id=?, vendor_id=?, asset_type_id=?,
           current_location_id=?, status=?, description=? WHERE id=?`,
          [
            row.name,
            row.rfid_tag || null,
            tagTypeId,
            vendorId,
            typeId,
            locationId,
            status,
            row.description || null,
            row._existingId,
          ]
        );
        if (row.attributes && typeId) {
          for (const [attrName, attrVal] of Object.entries(row.attributes)) {
            if (attrVal === '' && attrVal !== 0) continue;
            const attrType = (row.attrTypes && row.attrTypes[attrName]) || 'string';
            const attrId = await ensureAttr(typeId, attrName, attrType);
            await db.query(
              'INSERT INTO asset_attribute_values (asset_id, attribute_id, value) VALUES (?,?,?) ON DUPLICATE KEY UPDATE value=?',
              [row._existingId, attrId, attrVal, attrVal]
            );
          }
        }
        updated++;
      } else {
        const [result] = await db.query(
          `INSERT INTO assets (asset_serial, name, rfid_tag, tag_type_id, vendor_id, asset_type_id,
           current_location_id, status, description) VALUES (?,?,?,?,?,?,?,?,?)`,
          [
            row.asset_serial,
            row.name,
            row.rfid_tag || null,
            tagTypeId,
            vendorId,
            typeId,
            locationId,
            status,
            row.description || null,
          ]
        );
        const assetId = result.insertId;

        await db.query(
          'INSERT INTO movement_history (asset_id, from_location_id, to_location_id, notes) VALUES (?, NULL, ?, ?)',
          [assetId, locationId, 'Imported']
        );

        if (row.attributes && typeId) {
          for (const [attrName, attrVal] of Object.entries(row.attributes)) {
            const attrType = (row.attrTypes && row.attrTypes[attrName]) || 'string';
            const attrId = await ensureAttr(typeId, attrName, attrType);
            await db.query(
              'INSERT INTO asset_attribute_values (asset_id, attribute_id, value) VALUES (?,?,?) ON DUPLICATE KEY UPDATE value=?',
              [assetId, attrId, attrVal, attrVal]
            );
          }
        }
        inserted++;
      }
    } catch (e) {
      console.error('Import row error:', e.message, row);
      errors++;
    }
  }

  await audit.log(
    'Import',
    'Import',
    `Assets imported: ${inserted} inserted, ${updated} updated, ${errors} errors`,
    req.auditUser,
    req.auditUserId
  );
  res.json({ inserted, updated, errors });
});

module.exports = router;
