const {
  chunkArray,
  withTransaction,
} = require('../lib/importHelpers');
const {
  RFID_TAG_MOVEMENT_NOTE,
  normalizeRfidTag,
  isValidRfidTag,
  shouldLogRfidTagMovement,
} = require('../lib/rfidMovements');

const ASSET_COLS =
  'asset_serial, name, rfid_tag, tag_type_id, vendor_id, asset_type_id, current_location_id, status, description';

/**
 * Ensure attribute definitions exist; returns Map keyed by `${typeId}:${attrNameLower}` -> attrId
 */
function buildAttrLookup(allTypeAttrs) {
  const byType = {};
  allTypeAttrs.forEach((a) => {
    if (!byType[a.asset_type_id]) byType[a.asset_type_id] = [];
    byType[a.asset_type_id].push(a);
  });
  return { byType, list: allTypeAttrs };
}

function getAttrId(attrState, typeId, attrName) {
  const list = attrState.byType[typeId] || [];
  const hit = list.find((a) => a.name.toLowerCase() === attrName.toLowerCase());
  return hit ? hit.id : null;
}

function registerAttr(attrState, typeId, attrId, attrName) {
  if (!attrState.byType[typeId]) attrState.byType[typeId] = [];
  if (!attrState.byType[typeId].some((a) => a.id === attrId)) {
    attrState.byType[typeId].push({ id: attrId, name: attrName, asset_type_id: typeId });
  }
}

async function ensureMissingAttributes(conn, attrState, rows) {
  const pending = new Map();
  for (const row of rows) {
    const typeId = row._typeId;
    if (!typeId || !row.attributes) continue;
    for (const attrName of Object.keys(row.attributes)) {
      const key = `${typeId}:${attrName.toLowerCase()}`;
      if (getAttrId(attrState, typeId, attrName) || pending.has(key)) continue;
      const attrType = (row.attrTypes && row.attrTypes[attrName]) || 'string';
      pending.set(key, { typeId, attrName, attrType });
    }
  }
  if (!pending.size) return;

  const entries = [...pending.values()];
  for (const batch of chunkArray(entries, 100)) {
    const placeholders = batch.map(() => '(?,?,?)').join(',');
    const vals = batch.flatMap((e) => [e.typeId, e.attrName, e.attrType]);
    await conn.query(
      `INSERT IGNORE INTO asset_type_attributes (asset_type_id, name, attr_type) VALUES ${placeholders}`,
      vals
    );
  }

  const typeIds = [...new Set(entries.map((e) => e.typeId))];
  const [fresh] = await conn.query(
    `SELECT id, asset_type_id, name, attr_type FROM asset_type_attributes WHERE asset_type_id IN (${typeIds.map(() => '?').join(',')})`,
    typeIds
  );
  fresh.forEach((a) => registerAttr(attrState, a.asset_type_id, a.id, a.name));
}

async function bulkUpsertAttributeValues(conn, pairs) {
  if (!pairs.length) return;
  for (const batch of chunkArray(pairs, 400)) {
    const placeholders = batch.map(() => '(?,?,?)').join(',');
    const vals = batch.flatMap(([assetId, attrId, value]) => [assetId, attrId, value]);
    await conn.query(
      `INSERT INTO asset_attribute_values (asset_id, attribute_id, value) VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE value = VALUES(value)`,
      vals
    );
  }
}

function collectAttributePairs(rows, attrState, assetIdForRow) {
  const pairs = [];
  for (const row of rows) {
    const assetId = assetIdForRow(row);
    if (!assetId || !row.attributes || !row._typeId) continue;
    for (const [attrName, attrVal] of Object.entries(row.attributes)) {
      if (attrVal === '' && attrVal !== 0) continue;
      const attrId = getAttrId(attrState, row._typeId, attrName);
      if (attrId) pairs.push([assetId, attrId, attrVal]);
    }
  }
  return pairs;
}

async function batchInsertAssets(conn, rows) {
  if (!rows.length) return [];
  const placeholders = rows.map(() => '(?,?,?,?,?,?,?,?,?)').join(',');
  const vals = rows.flatMap((row) => [
    row.asset_serial,
    row.name,
    row.rfid_tag || null,
    row.tag_type_id,
    row.vendor_id,
    row._typeId,
    row._locationId,
    row.status || 'active',
    row.description || null,
  ]);
  const [result] = await conn.query(
    `INSERT INTO assets (${ASSET_COLS}) VALUES ${placeholders}`,
    vals
  );
  const firstId = result.insertId;
  return rows.map((row, i) => ({ row, assetId: firstId + i }));
}

async function batchUpdateAssets(conn, rows) {
  if (!rows.length) return;
  const placeholders = rows.map(() => '(?,?,?,?,?,?,?,?,?)').join(',');
  const vals = rows.flatMap((row) => [
    row._existingId,
    row.name,
    row.rfid_tag || null,
    row.tag_type_id,
    row.vendor_id,
    row._typeId,
    row._locationId,
    row.status || 'active',
    row.description || null,
  ]);
  await conn.query(
    `INSERT INTO assets (id, name, rfid_tag, tag_type_id, vendor_id, asset_type_id, current_location_id, status, description)
     VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       rfid_tag = VALUES(rfid_tag),
       tag_type_id = VALUES(tag_type_id),
       vendor_id = VALUES(vendor_id),
       asset_type_id = VALUES(asset_type_id),
       current_location_id = VALUES(current_location_id),
       status = VALUES(status),
       description = VALUES(description)`,
    vals
  );
}

/** movements: [assetId, fromLocationId, toLocationId, notes] */
async function batchInsertMovements(conn, movements) {
  if (!movements.length) return;
  for (const batch of chunkArray(movements, 400)) {
    const placeholders = batch.map(() => '(?,?,?,?)').join(',');
    const vals = batch.flatMap(([assetId, fromLoc, toLoc, notes]) => [
      assetId,
      fromLoc,
      toLoc,
      notes,
    ]);
    await conn.query(
      `INSERT INTO movement_history (asset_id, from_location_id, to_location_id, notes) VALUES ${placeholders}`,
      vals
    );
  }
}

async function executeAssetChunk(conn, rows, attrState) {
  let inserted = 0;
  let updated = 0;
  let errors = 0;

  const valid = [];
  for (const row of rows) {
    if (row._status === 'error') {
      errors++;
      continue;
    }
    if (!row._locationId || !row._typeId || !row.tag_type_id || !row.vendor_id) {
      errors++;
      continue;
    }
    if (normalizeRfidTag(row.rfid_tag) && !isValidRfidTag(row.rfid_tag)) {
      errors++;
      continue;
    }
    valid.push(row);
  }

  const inserts = valid.filter((r) => r._status === 'insert');
  const updates = valid.filter((r) => r._status === 'update');

  await ensureMissingAttributes(conn, attrState, valid);

  if (updates.length) {
    for (const batch of chunkArray(updates, 200)) {
      const ids = batch.map((r) => r._existingId);
      const [existingRows] = await conn.query(
        `SELECT id, rfid_tag FROM assets WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids
      );
      const rfidById = new Map(existingRows.map((r) => [r.id, r.rfid_tag]));
      await batchUpdateAssets(conn, batch);
      updated += batch.length;
      const rfidMovements = [];
      for (const row of batch) {
        if (shouldLogRfidTagMovement(rfidById.get(row._existingId), row.rfid_tag) && row._locationId) {
          rfidMovements.push([row._existingId, row._locationId, row._locationId, RFID_TAG_MOVEMENT_NOTE]);
        }
      }
      await batchInsertMovements(conn, rfidMovements);
    }
    const attrPairs = collectAttributePairs(updates, attrState, (r) => r._existingId);
    await bulkUpsertAttributeValues(conn, attrPairs);
  }

  if (inserts.length) {
    for (const batch of chunkArray(inserts, 200)) {
      const linked = await batchInsertAssets(conn, batch);
      inserted += linked.length;
      const idBySerial = new Map(linked.map(({ row, assetId }) => [row.asset_serial, assetId]));
      const placementMovements = [];
      const rfidMovements = [];
      for (const { assetId, row } of linked) {
        placementMovements.push([assetId, row._locationId, null, 'Imported']);
        if (isValidRfidTag(row.rfid_tag)) {
          rfidMovements.push([assetId, row._locationId, row._locationId, RFID_TAG_MOVEMENT_NOTE]);
        }
      }
      await batchInsertMovements(conn, placementMovements);
      await batchInsertMovements(conn, rfidMovements);
      const attrPairs = collectAttributePairs(batch, attrState, (row) => idBySerial.get(row.asset_serial));
      await bulkUpsertAttributeValues(conn, attrPairs);
    }
  }

  return { inserted, updated, errors };
}

/**
 * Execute asset import in transactional chunks.
 */
async function executeAssetsImport(db, rows) {
  const [allTypeAttrs] = await db.query(
    'SELECT id, asset_type_id, name, attr_type FROM asset_type_attributes'
  );
  const attrState = buildAttrLookup(allTypeAttrs);

  let inserted = 0;
  let updated = 0;
  let errors = 0;

  for (const chunk of chunkArray(rows, 500)) {
    try {
      const stats = await withTransaction(db, (conn) => executeAssetChunk(conn, chunk, attrState));
      inserted += stats.inserted;
      updated += stats.updated;
      errors += stats.errors;
    } catch (e) {
      console.error('Import chunk error:', e.message);
      errors += chunk.filter((r) => r._status !== 'error').length;
    }
  }

  return { inserted, updated, errors };
}

module.exports = { executeAssetsImport };
