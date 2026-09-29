const express = require('express');
const router = express.Router();
const db = require('../db');
const audit = require('../audit');
const { executeAssetsImport } = require('../services/assetImportExecute');
const { normalizeRfidTag, isValidRfidTag, validateOptionalRfidTag } = require('../lib/rfidMovements');
const {
  chunkArray,
  buildNameMap,
  buildIdMap,
  buildSerialMap,
  buildAssetCodeMap,
  buildRfidMap,
  markImportRowDuplicates,
  markAssetTypeNameDuplicatesInFile,
  findInNameMap,
  resolveMasterIdFromMaps,
  slimAssetPreviewRow,
  slimLocationPreviewRow,
  slimAssetTypePreviewRow,
  withTransaction,
} = require('../lib/importHelpers');
const { findAssetTypeNameConflict } = require('../lib/assetTypeName');
const { requireModify } = require('../middleware/requireAuthz');

const VALID_ASSET_STATUSES = new Set(['active', 'inactive', 'maintenance']);

function findBestMatch(name, list) {
  return findInNameMap(name, buildNameMap(list));
}

function normalizeStatus(raw) {
  const s = (raw || 'active').toString().trim().toLowerCase();
  return VALID_ASSET_STATUSES.has(s) ? s : null;
}

function trimImportCell(value) {
  if (value == null || value === '') return '';
  return String(value).trim();
}

function normalizeAssetImportRow(row) {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    asset_code: trimImportCell(row.asset_code),
    asset_serial: trimImportCell(row.asset_serial),
    name: trimImportCell(row.name),
    rfid_tag: normalizeRfidTag(row.rfid_tag),
    asset_type: trimImportCell(row.asset_type),
    location: trimImportCell(row.location),
    tag_type: trimImportCell(row.tag_type),
    vendor: trimImportCell(row.vendor),
    status: trimImportCell(row.status),
    description: trimImportCell(row.description),
  };
}

function collectMissingNames(rows, nameKey, nameMap) {
  const missing = new Set();
  rows.forEach((row) => {
    const normalized = normalizeAssetImportRow(row);
    const name = (normalized[nameKey] || '').trim();
    if (!name) return;
    if (!findInNameMap(name, nameMap)) missing.add(name);
  });
  return [...missing];
}

async function bulkInsertIgnoreNames(conn, table, names, description = null) {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (!unique.length) return 0;
  let created = 0;
  for (const batch of chunkArray(unique, 150)) {
    if (table === 'asset_types') {
      const placeholders = batch.map(() => '(?, ?)').join(',');
      const vals = batch.flatMap((n) => [n, description || null]);
      const [r] = await conn.query(
        `INSERT IGNORE INTO asset_types (name, description) VALUES ${placeholders}`,
        vals
      );
      created += r.affectedRows || 0;
    } else if (table === 'locations') {
      const placeholders = batch.map(() => '(?)').join(',');
      const [r] = await conn.query(`INSERT IGNORE INTO locations (name) VALUES ${placeholders}`, batch);
      created += r.affectedRows || 0;
    } else if (table === 'tag_types') {
      const placeholders = batch.map(() => '(?, ?)').join(',');
      const vals = batch.flatMap((n) => [n, 'Created via import']);
      const [r] = await conn.query(
        `INSERT IGNORE INTO tag_types (name, description) VALUES ${placeholders}`,
        vals
      );
      created += r.affectedRows || 0;
    } else if (table === 'vendors') {
      const placeholders = batch.map(() => '(?)').join(',');
      const [r] = await conn.query(`INSERT IGNORE INTO vendors (name) VALUES ${placeholders}`, batch);
      created += r.affectedRows || 0;
    }
  }
  return created;
}

async function bulkEnsureTypeAttributes(conn, rows, typeNameMap) {
  const pending = new Map();
  for (const row of rows) {
    if (!row.asset_type?.trim() || !row.attrTypes) continue;
    const type = findInNameMap(row.asset_type, typeNameMap);
    if (!type) continue;
    for (const [attrName, attrType] of Object.entries(row.attrTypes)) {
      const key = `${type.id}:${attrName.toLowerCase()}`;
      if (!pending.has(key)) pending.set(key, { typeId: type.id, attrName, attrType: attrType || 'string' });
    }
  }
  const entries = [...pending.values()];
  if (!entries.length) return;
  for (const batch of chunkArray(entries, 100)) {
    const placeholders = batch.map(() => '(?,?,?)').join(',');
    const vals = batch.flatMap((e) => [e.typeId, e.attrName, e.attrType]);
    await conn.query(
      `INSERT IGNORE INTO asset_type_attributes (asset_type_id, name, attr_type) VALUES ${placeholders}`,
      vals
    );
  }
}

function validateAssetImportRow(row, ctx) {
  const {
    typeNameMap,
    locationNameMap,
    tagTypeNameMap,
    tagTypeIdMap,
    vendorNameMap,
    vendorIdMap,
    serialMap,
    assetCodeMap,
    rfidMap,
  } = ctx;
  const errors = [];

  const assetCode = trimImportCell(row.asset_code);
  const serial = trimImportCell(row.asset_serial);
  const name = trimImportCell(row.name);
  const rfidTag = normalizeRfidTag(row.rfid_tag);
  if (!assetCode) errors.push('Asset ID is required');
  if (!name) errors.push('Asset Name is required');
  validateOptionalRfidTag(rfidTag, errors);

  let typeMatch = null;
  let typeFix = null;
  if (!row.asset_type?.trim()) {
    errors.push('Asset Type is required');
  } else {
    typeMatch = findInNameMap(row.asset_type, typeNameMap);
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
    locationMatch = findInNameMap(row.location, locationNameMap);
    if (!locationMatch) errors.push(`Location "${row.location}" not found`);
    else if (locationMatch.name.toLowerCase() !== row.location.trim().toLowerCase()) {
      locationFix = locationMatch.name;
    }
  }

  const tagRes = resolveMasterIdFromMaps(row, 'tag_type_id', 'tag_type', tagTypeNameMap, tagTypeIdMap, 'Tag type');
  if (tagRes.error) errors.push(tagRes.error);

  const vendorRes = resolveMasterIdFromMaps(row, 'vendor_id', 'vendor', vendorNameMap, vendorIdMap, 'Vendor');
  if (vendorRes.error) errors.push(vendorRes.error);

  let status = row.status;
  if (row.status != null && String(row.status).trim() !== '') {
    const normalized = normalizeStatus(row.status);
    if (!normalized) errors.push('Status must be active, inactive, or maintenance');
    else status = normalized;
  }

  const codeOwner = assetCode ? assetCodeMap.get(assetCode.toLowerCase()) || null : null;
  const serialOwner = serial ? serialMap.get(serial) || null : null;
  const existingMatch = codeOwner || serialOwner;

  if (serialOwner && existingMatch && serialOwner.id !== existingMatch.id) {
    errors.push(`Asset Serial is already used by another asset (Asset ID: ${serialOwner.asset_code})`);
  }

  if (rfidTag && isValidRfidTag(rfidTag)) {
    const rfidOwner = rfidMap.get(rfidTag);
    if (rfidOwner) {
      const assetId = existingMatch ? existingMatch.id : null;
      if (assetId !== rfidOwner.id) {
        const ref = rfidOwner.asset_code ? ` (Asset ID: ${rfidOwner.asset_code})` : '';
        errors.push(`RFID tag is already assigned to another asset${ref}`);
      }
    }
  }

  return slimAssetPreviewRow({
    asset_code: assetCode || row.asset_code,
    asset_serial: serial || row.asset_serial,
    name: name || row.name,
    rfid_tag: rfidTag || row.rfid_tag,
    asset_type: row.asset_type,
    location: row.location,
    tag_type: row.tag_type,
    vendor: row.vendor,
    status,
    description: row.description,
    attributes: row.attributes,
    attrTypes: row.attrTypes,
    tag_type_id: tagRes.id,
    vendor_id: vendorRes.id,
    _status: errors.length ? 'error' : existingMatch ? 'update' : 'insert',
    _errors: errors,
    _typeFix: typeFix,
    _locationFix: locationFix,
    _tagTypeFix: tagRes.fix,
    _vendorFix: vendorRes.fix,
    _typeId: typeMatch ? typeMatch.id : null,
    _locationId: locationMatch ? locationMatch.id : null,
    _existingId: existingMatch ? existingMatch.id : null,
  });
}

async function executeLocationsBatch(rows) {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  const valid = rows.filter((r) => r._status !== 'error');
  errors += rows.length - valid.length;
  const updates = valid.filter((r) => r._status === 'update');
  const inserts = valid.filter((r) => r._status === 'insert');

  for (const batch of chunkArray(updates, 500)) {
    await withTransaction(db, async (conn) => {
      const placeholders = batch.map(() => '(?,?,?,?)').join(',');
      const vals = batch.flatMap((row) => [
        row._existingId,
        row.name,
        row.description || null,
        row._parentId || null,
      ]);
      await conn.query(
        `INSERT INTO locations (id, name, description, parent_id) VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           description = VALUES(description),
           parent_id = VALUES(parent_id)`,
        vals
      );
      updated += batch.length;
    });
  }

  for (const batch of chunkArray(inserts, 200)) {
    await withTransaction(db, async (conn) => {
      const placeholders = batch.map(() => '(?,?,?)').join(',');
      const vals = batch.flatMap((row) => [row.name, row.description || null, row._parentId || null]);
      const [result] = await conn.query(
        `INSERT INTO locations (name, description, parent_id) VALUES ${placeholders}`,
        vals
      );
      inserted += result.affectedRows || batch.length;
    });
  }

  return { inserted, updated, skipped, errors };
}

async function executeAssetTypesBatch(rows) {
  let inserted = 0;
  let updated = 0;
  let errors = 0;

  const nameToId = {};
  const [existingTypes] = await db.query('SELECT id, name FROM asset_types');
  existingTypes.forEach((t) => {
    nameToId[t.name.toLowerCase()] = t.id;
  });

  const valid = rows.filter((r) => r._status !== 'error');
  errors += rows.length - valid.length;

  for (const row of valid) {
    try {
      let parentId = null;
      if (row.parent_name && row.parent_name.trim()) {
        parentId = nameToId[row.parent_name.trim().toLowerCase()] || null;
      }

      if (row._status === 'update') {
        await db.query(
          'UPDATE asset_types SET description=?, parent_id=? WHERE id=?',
          [row.description || null, parentId, row._existingId]
        );
        updated++;
        if (row.attributes && row.attributes.length) {
          for (const attr of row.attributes) {
            await db.query(
              'INSERT IGNORE INTO asset_type_attributes (asset_type_id, name, attr_type) VALUES (?,?,?)',
              [row._existingId, attr.name, attr.type || 'string']
            );
          }
        }
      } else {
        const typeName = (row.name || '').trim();
        const conflict = await findAssetTypeNameConflict(db, typeName);
        if (conflict) {
          errors++;
          continue;
        }
        const [result] = await db.query(
          'INSERT INTO asset_types (name, description, parent_id) VALUES (?,?,?)',
          [typeName, row.description || null, parentId]
        );
        nameToId[typeName.toLowerCase()] = result.insertId;
        if (row.attributes && row.attributes.length) {
          const attrRows = row.attributes.map((attr) => [
            result.insertId,
            attr.name,
            attr.type || 'string',
          ]);
          for (const batch of chunkArray(attrRows, 50)) {
            const placeholders = batch.map(() => '(?,?,?)').join(',');
            await db.query(
              `INSERT IGNORE INTO asset_type_attributes (asset_type_id, name, attr_type) VALUES ${placeholders}`,
              batch.flat()
            );
          }
        }
        inserted++;
      }
    } catch {
      errors++;
    }
  }

  return { inserted, updated, errors };
}

// ── Locations ──────────────────────────────────────────────────

router.post('/locations/preview', requireModify('location'), async (req, res) => {
  const { rows } = req.body;
  const [existing] = await db.query('SELECT id, name FROM locations');
  const nameMap = buildNameMap(existing);

  const result = rows.map((row) => {
    const name = (row.name || '').trim();
    const parentName = (row.parent_name || '').trim();
    const errors = [];

    if (!name) errors.push('Location name is required');

    let parentMatch = null;
    let parentFix = null;
    if (parentName) {
      parentMatch = findInNameMap(parentName, nameMap);
      if (!parentMatch) errors.push(`Parent location "${parentName}" not found`);
      else if (parentMatch.name.toLowerCase() !== parentName.toLowerCase()) parentFix = parentMatch.name;
    }

    const existingMatch = findInNameMap(name, nameMap);

    return slimLocationPreviewRow({
      name: row.name,
      parent_name: row.parent_name,
      description: row.description,
      _status: errors.length ? 'error' : existingMatch ? 'update' : 'insert',
      _errors: errors,
      _parentFix: parentFix,
      _existingId: existingMatch ? existingMatch.id : null,
      _parentId: parentMatch ? parentMatch.id : null,
    });
  });

  res.json(result);
});

router.post('/locations/execute', requireModify('location'), async (req, res) => {
  const { rows } = req.body;
  const stats = await executeLocationsBatch(rows);
  await audit.log(
    'Import',
    'Import',
    `Locations imported: ${stats.inserted} inserted, ${stats.updated} updated, ${stats.errors} errors`,
    req.auditUser,
    req.auditUserId
  );
  res.json(stats);
});

// ── Asset types ────────────────────────────────────────────────

router.post('/asset-types/preview', requireModify('asset_type'), async (req, res) => {
  const { rows } = req.body;
  const [existing] = await db.query('SELECT id, name FROM asset_types');
  const nameMap = buildNameMap(existing);

  const result = rows.map((row) => {
    const name = (row.name || '').trim();
    const errors = [];
    if (!name) errors.push('Asset type name is required');

    const existingMatch = findInNameMap(name, nameMap);

    let parentMatch = null;
    let parentFix = null;
    if (row.parent_name && row.parent_name.trim()) {
      parentMatch = findInNameMap(row.parent_name.trim(), nameMap);
      if (!parentMatch) errors.push(`Parent type "${row.parent_name}" not found`);
      else if (parentMatch.name.toLowerCase() !== row.parent_name.trim().toLowerCase()) {
        parentFix = parentMatch.name;
      }
    }

    return slimAssetTypePreviewRow({
      name: row.name,
      parent_name: row.parent_name,
      description: row.description,
      attributes: row.attributes,
      _status: errors.length ? 'error' : existingMatch ? 'update' : 'insert',
      _errors: errors,
      _parentFix: parentFix,
      _parentId: parentMatch ? parentMatch.id : null,
      _existingId: existingMatch ? existingMatch.id : null,
    });
  });

  markAssetTypeNameDuplicatesInFile(result);
  res.json(result);
});

router.post('/asset-types/execute', requireModify('asset_type'), async (req, res) => {
  const { rows } = req.body;
  const stats = await executeAssetTypesBatch(rows);
  await audit.log(
    'Import',
    'Import',
    `Asset types imported: ${stats.inserted} inserted, ${stats.updated} updated, ${stats.errors} errors`,
    req.auditUser,
    req.auditUserId
  );
  res.json(stats);
});

// ── Assets: check / smartfix / preview / execute ───────────────

router.post('/assets/check', requireModify('asset'), async (req, res) => {
  const rows = (req.body.rows || []).map(normalizeAssetImportRow);
  const [assetTypes] = await db.query('SELECT id, name FROM asset_types');
  const [locations] = await db.query('SELECT id, name FROM locations');
  const [tagTypes] = await db.query('SELECT id, name FROM tag_types');
  const [vendors] = await db.query('SELECT id, name FROM vendors');

  res.json({
    missingTypes: collectMissingNames(rows, 'asset_type', buildNameMap(assetTypes)),
    missingLocations: collectMissingNames(rows, 'location', buildNameMap(locations)),
    missingTagTypes: collectMissingNames(rows, 'tag_type', buildNameMap(tagTypes)),
    missingVendors: collectMissingNames(rows, 'vendor', buildNameMap(vendors)),
  });
});

router.post('/assets/smartfix', requireModify('asset'), async (req, res) => {
  const rows = (req.body.rows || []).map(normalizeAssetImportRow);

  const typeNames = new Set();
  const locationNames = new Set();
  const tagNames = new Set();
  const vendorNames = new Set();

  rows.forEach((row) => {
    if (row.asset_type?.trim()) typeNames.add(row.asset_type.trim());
    if (row.location?.trim()) locationNames.add(row.location.trim());
    if (row.tag_type?.trim()) tagNames.add(row.tag_type.trim());
    if (row.vendor?.trim()) vendorNames.add(row.vendor.trim());
  });

  const createdTypes = [];
  const createdLocations = [];
  const createdTagTypeNames = [];
  const createdVendorNames = [];

  await withTransaction(db, async (conn) => {
    const [assetTypes] = await conn.query('SELECT id, name FROM asset_types');
    const [locations] = await conn.query('SELECT id, name FROM locations');
    const [tagTypes] = await conn.query('SELECT id, name FROM tag_types');
    const [vendors] = await conn.query('SELECT id, name FROM vendors');

    const typeMap = buildNameMap(assetTypes);
    const locMap = buildNameMap(locations);
    const tagMap = buildNameMap(tagTypes);
    const vendorMap = buildNameMap(vendors);

    const newTypes = [...typeNames].filter((n) => !findInNameMap(n, typeMap));
    const newLocs = [...locationNames].filter((n) => !findInNameMap(n, locMap));
    const newTags = [...tagNames].filter((n) => !findInNameMap(n, tagMap));
    const newVendors = [...vendorNames].filter((n) => !findInNameMap(n, vendorMap));

    if (newTypes.length) {
      await bulkInsertIgnoreNames(conn, 'asset_types', newTypes);
      createdTypes.push(...newTypes);
    }
    if (newLocs.length) {
      await bulkInsertIgnoreNames(conn, 'locations', newLocs);
      createdLocations.push(...newLocs);
    }
    if (newTags.length) {
      await bulkInsertIgnoreNames(conn, 'tag_types', newTags);
      createdTagTypeNames.push(...newTags);
    }
    if (newVendors.length) {
      await bulkInsertIgnoreNames(conn, 'vendors', newVendors);
      createdVendorNames.push(...newVendors);
    }

    const [assetTypesAfter] = await conn.query('SELECT id, name FROM asset_types');
    await bulkEnsureTypeAttributes(conn, rows, buildNameMap(assetTypesAfter));
  });

  res.json({
    createdTypes,
    createdLocations,
    createdTagTypes: createdTagTypeNames,
    createdVendors: createdVendorNames,
  });
});

router.post('/assets/preview', requireModify('asset'), async (req, res) => {
  const rows = (req.body.rows || []).map(normalizeAssetImportRow);
  const ctx = await buildAssetImportContext();
  const result = rows.map((row) => validateAssetImportRow(row, ctx));
  markImportRowDuplicates(result);
  res.json(result);
});

async function buildAssetImportContext() {
  const [existingAssets] = await db.query('SELECT id, asset_code, asset_serial, rfid_tag FROM assets');
  const [assetTypes] = await db.query('SELECT id, name FROM asset_types');
  const [locations] = await db.query('SELECT id, name FROM locations');
  const [tagTypes] = await db.query('SELECT id, name FROM tag_types');
  const [vendors] = await db.query('SELECT id, name FROM vendors');
  return {
    typeNameMap: buildNameMap(assetTypes),
    locationNameMap: buildNameMap(locations),
    tagTypeNameMap: buildNameMap(tagTypes),
    tagTypeIdMap: buildIdMap(tagTypes),
    vendorNameMap: buildNameMap(vendors),
    vendorIdMap: buildIdMap(vendors),
    serialMap: buildSerialMap(existingAssets),
    assetCodeMap: buildAssetCodeMap(existingAssets),
    rfidMap: buildRfidMap(existingAssets),
  };
}

router.post('/assets/execute', requireModify('asset'), async (req, res) => {
  const rows = (req.body.rows || []).map(normalizeAssetImportRow);
  const ctx = await buildAssetImportContext();
  const validated = rows.map((row) => validateAssetImportRow(row, ctx));
  markImportRowDuplicates(validated);
  const stats = await executeAssetsImport(db, validated);
  await audit.log(
    'Import',
    'Import',
    `Assets imported: ${stats.inserted} inserted, ${stats.updated} updated, ${stats.errors} errors`,
    req.auditUser,
    req.auditUserId
  );
  res.json(stats);
});

module.exports = router;
