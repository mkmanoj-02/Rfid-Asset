const express = require('express');
const router = express.Router();
const db = require('../db');
const audit = require('../audit');

// Helper: exact case-insensitive match only.
// Fuzzy/partial matching caused false positives (e.g. "2cqr" matching "2cqr_oragadam").
function findBestMatch(name, list) {
  if (!name) return null;
  const lower = name.trim().toLowerCase();
  return list.find(i => i.name.toLowerCase() === lower) || null;
}

// Preview + validate locations
router.post('/locations/preview', async (req, res) => {
  const { rows } = req.body; // [{ Location, Parent Location, Description, ... }]
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

// Execute location import
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

// Preview + validate asset types
router.post('/asset-types/preview', async (req, res) => {
  const { rows } = req.body;
  const [existing] = await db.query('SELECT id, name FROM asset_types');

  // Build a working list that includes types being inserted in this same batch
  // so a child can reference a parent that is also in the import file
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

    // Add this row to workingList (with a placeholder id) so subsequent rows
    // in the same batch can reference it as a parent
    if (!existingMatch && name) {
      workingList.push({ id: `_new_${name}`, name });
    }

    return {
      ...row,
      _status: errors.length ? 'error' : existingMatch ? 'update' : 'insert',
      _errors: errors,
      _parentFix: parentFix,
      _parentId: parentMatch ? parentMatch.id : null,   // ← was missing
      _existingId: existingMatch ? existingMatch.id : null,
    };
  });

  res.json(result);
});

// Execute asset type import
router.post('/asset-types/execute', async (req, res) => {
  const { rows } = req.body;
  let inserted = 0, updated = 0, errors = 0;

  // Keep a name→id map so child types inserted in this batch can find
  // parents that were also inserted in this same batch
  const nameToId = {};

  // Pre-seed with existing types from DB
  const [existingTypes] = await db.query('SELECT id, name FROM asset_types');
  existingTypes.forEach(t => { nameToId[t.name.toLowerCase()] = t.id; });

  for (const row of rows) {
    if (row._status === 'error') { errors++; continue; }
    try {
      // Resolve parent_id: prefer the stored _parentId, but if it's a
      // placeholder (_new_...) look it up in nameToId (inserted earlier in batch)
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
        // Register in map so subsequent rows in this batch can use it as parent
        nameToId[row.name.toLowerCase()] = result.insertId;

        // Handle attributes
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

// Check missing asset types and locations before preview
router.post('/assets/check', async (req, res) => {
  const { rows } = req.body;
  const [assetTypes] = await db.query('SELECT id, name FROM asset_types');
  const [locations] = await db.query('SELECT id, name FROM locations');

  const missingTypesSet = new Set();
  const missingLocationsSet = new Set();

  rows.forEach(row => {
    if (row.asset_type && row.asset_type.trim()) {
      const match = findBestMatch(row.asset_type, assetTypes);
      if (!match) missingTypesSet.add(row.asset_type.trim());
    }
    if (row.location && row.location.trim()) {
      const match = findBestMatch(row.location, locations);
      if (!match) missingLocationsSet.add(row.location.trim());
    }
  });

  res.json({
    missingTypes: [...missingTypesSet],
    missingLocations: [...missingLocationsSet],
  });
});

// Smart fix: create missing asset types and locations
router.post('/assets/smartfix', async (req, res) => {
  const { rows } = req.body;
  const [assetTypes] = await db.query('SELECT id, name FROM asset_types');
  const [locations] = await db.query('SELECT id, name FROM locations');

  const createdTypes = new Set();
  const createdLocations = new Set();

  for (const row of rows) {
    if (row.asset_type && row.asset_type.trim()) {
      const match = findBestMatch(row.asset_type, assetTypes);
      if (!match && !createdTypes.has(row.asset_type.trim())) {
        const [result] = await db.query('INSERT INTO asset_types (name) VALUES (?)', [row.asset_type.trim()]);
        assetTypes.push({ id: result.insertId, name: row.asset_type.trim() });
        // Create attributes if provided
        if (row.attributes && row.attrTypes) {
          for (const [attrName, attrType] of Object.entries(row.attrTypes)) {
            await db.query('INSERT IGNORE INTO asset_type_attributes (asset_type_id, name, attr_type) VALUES (?,?,?)',
              [result.insertId, attrName, attrType || 'string']);
          }
        }
        createdTypes.add(row.asset_type.trim());
      }
    }
    if (row.location && row.location.trim()) {
      const match = findBestMatch(row.location, locations);
      if (!match && !createdLocations.has(row.location.trim())) {
        const [result] = await db.query('INSERT INTO locations (name) VALUES (?)', [row.location.trim()]);
        locations.push({ id: result.insertId, name: row.location.trim() });
        createdLocations.add(row.location.trim());
      }
    }
  }

  res.json({ createdTypes: [...createdTypes], createdLocations: [...createdLocations] });
});

// Preview + validate assets
router.post('/assets/preview', async (req, res) => {
  const { rows } = req.body;
  const [existingAssets] = await db.query('SELECT id, asset_serial FROM assets');
  const [assetTypes] = await db.query('SELECT id, name FROM asset_types');
  const [locations] = await db.query('SELECT id, name FROM locations');

  const result = rows.map(row => {
    const serial = (row.asset_serial || '').trim();
    const name = (row.name || '').trim();
    const errors = [];

    if (!serial) errors.push('Asset Serial is required');
    if (!name) errors.push('Asset Name is required');

    // Asset type match
    let typeMatch = null, typeFix = null;
    if (row.asset_type && row.asset_type.trim()) {
      typeMatch = findBestMatch(row.asset_type, assetTypes);
      if (!typeMatch) errors.push(`Asset type "${row.asset_type}" not found`);
      else if (typeMatch.name.toLowerCase() !== row.asset_type.trim().toLowerCase()) typeFix = typeMatch.name;
    }

    // Location match
    let locationMatch = null, locationFix = null;
    if (row.location && row.location.trim()) {
      locationMatch = findBestMatch(row.location, locations);
      if (!locationMatch) errors.push(`Location "${row.location}" not found`);
      else if (locationMatch.name.toLowerCase() !== row.location.trim().toLowerCase()) locationFix = locationMatch.name;
    }

    const existingMatch = serial ? existingAssets.find(a => a.asset_serial === serial) : null;

    return {
      ...row,
      _status: errors.length ? 'error' : existingMatch ? 'update' : 'insert',
      _errors: errors,
      _typeFix: typeFix,
      _locationFix: locationFix,
      _typeId: typeMatch ? typeMatch.id : null,
      _locationId: locationMatch ? locationMatch.id : null,
      _existingId: existingMatch ? existingMatch.id : null,
    };
  });

  res.json(result);
});

// Execute asset import
router.post('/assets/execute', async (req, res) => {
  const { rows } = req.body;
  let inserted = 0, updated = 0, errors = 0;

  // Pre-load all asset types and their attributes once
  const [assetTypes] = await db.query('SELECT id, name FROM asset_types');
  const [allTypeAttrs] = await db.query('SELECT id, asset_type_id, name, attr_type FROM asset_type_attributes');

  // Cache: typeId -> [{ id, name }]
  const attrCache = {};
  allTypeAttrs.forEach(a => {
    if (!attrCache[a.asset_type_id]) attrCache[a.asset_type_id] = [];
    attrCache[a.asset_type_id].push(a);
  });

  // Ensure attributes exist on asset type, return attr id
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
    try {
      const locationId = row._locationId || 1;
      const typeId = row._typeId || null;

      if (row._status === 'update') {
        await db.query(
          'UPDATE assets SET name=?, rfid_tag=?, tag_type_id=?, asset_type_id=?, current_location_id=?, description=? WHERE id=?',
          [row.name, row.rfid_tag || null, row.tag_type_id || null, typeId, locationId, row.description || null, row._existingId]
        );
        // Save attribute values on update too
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
        // Insert asset
        const [result] = await db.query(
          'INSERT INTO assets (asset_serial, name, rfid_tag, tag_type_id, asset_type_id, current_location_id, status, description) VALUES (?,?,?,?,?,?,?,?)',
          [row.asset_serial, row.name, row.rfid_tag || null, row.tag_type_id || null, typeId, locationId, 'active', row.description || null]
        );
        const assetId = result.insertId;

        // Movement history
        await db.query(
          'INSERT INTO movement_history (asset_id, from_location_id, to_location_id, notes) VALUES (?, NULL, ?, ?)',
          [assetId, locationId, 'Imported']
        );

        // Save attribute values
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
  await audit.log('Import', 'Import', `Assets imported: ${inserted} inserted, ${updated} updated, ${errors} errors`, req.auditUser, req.auditUserId);
  res.json({ inserted, updated, errors });
});

module.exports = router;
