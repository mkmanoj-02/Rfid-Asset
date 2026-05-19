/** Shared helpers for import preview / execute performance. */

const CHUNK_SIZE = 500;

function chunkArray(arr, size = CHUNK_SIZE) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildNameMap(list) {
  const map = new Map();
  (list || []).forEach((item) => {
    if (item?.name) map.set(item.name.toLowerCase(), item);
  });
  return map;
}

function buildIdMap(list) {
  const map = new Map();
  (list || []).forEach((item) => {
    if (item?.id != null) map.set(Number(item.id), item);
  });
  return map;
}

function buildSerialMap(assets) {
  const map = new Map();
  (assets || []).forEach((a) => {
    if (a?.asset_serial) map.set(a.asset_serial, a);
  });
  return map;
}

function findInNameMap(name, nameMap) {
  if (!name) return null;
  return nameMap.get(name.trim().toLowerCase()) || null;
}

function resolveMasterIdFromMaps(row, idKey, nameKey, nameMap, idMap, label) {
  const idRaw = row[idKey];
  if (idRaw != null && idRaw !== '') {
    const id = Number(idRaw);
    if (!Number.isNaN(id)) {
      const hit = idMap.get(id);
      if (hit) return { id: hit.id, fix: null, error: null };
      return { id: null, fix: null, error: `${label} id ${id} not found` };
    }
  }
  const name = (row[nameKey] || '').trim();
  if (!name) return { id: null, fix: null, error: null };
  const match = findInNameMap(name, nameMap);
  if (!match) return { id: null, fix: null, error: `${label} "${name}" not found` };
  const fix = match.name.toLowerCase() !== name.toLowerCase() ? match.name : null;
  return { id: match.id, fix, error: null };
}

/** Slim preview row for assets (display + execute metadata, no duplicate spread). */
function slimAssetPreviewRow(row) {
  return {
    asset_serial: row.asset_serial,
    name: row.name,
    rfid_tag: row.rfid_tag,
    asset_type: row.asset_type,
    location: row.location,
    tag_type: row.tag_type,
    vendor: row.vendor,
    status: row.status,
    description: row.description,
    attributes: row.attributes,
    attrTypes: row.attrTypes,
    tag_type_id: row.tag_type_id,
    vendor_id: row.vendor_id,
    _status: row._status,
    _errors: row._errors,
    _typeFix: row._typeFix,
    _locationFix: row._locationFix,
    _tagTypeFix: row._tagTypeFix,
    _vendorFix: row._vendorFix,
    _typeId: row._typeId,
    _locationId: row._locationId,
    _existingId: row._existingId,
  };
}

function slimLocationPreviewRow(row) {
  return {
    name: row.name,
    parent_name: row.parent_name,
    description: row.description,
    _status: row._status,
    _errors: row._errors,
    _parentFix: row._parentFix,
    _existingId: row._existingId,
    _parentId: row._parentId,
  };
}

function slimAssetTypePreviewRow(row) {
  return {
    name: row.name,
    parent_name: row.parent_name,
    description: row.description,
    attributes: row.attributes,
    _status: row._status,
    _errors: row._errors,
    _parentFix: row._parentFix,
    _parentId: row._parentId,
    _existingId: row._existingId,
  };
}

async function withTransaction(pool, fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  CHUNK_SIZE,
  chunkArray,
  buildNameMap,
  buildIdMap,
  buildSerialMap,
  findInNameMap,
  resolveMasterIdFromMaps,
  slimAssetPreviewRow,
  slimLocationPreviewRow,
  slimAssetTypePreviewRow,
  withTransaction,
};
