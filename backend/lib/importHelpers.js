/** Shared helpers for import preview / execute performance. */

const { normalizeRfidTag, isValidRfidTag } = require('./rfidMovements');

const CHUNK_SIZE = 500;

const RFID_DUP_FILE_MSG = 'Duplicate RFID tag in import file';
const ASSET_CODE_DUP_FILE_MSG = 'Duplicate Asset ID / Asset Serial in import file';
const ASSET_TYPE_DUP_FILE_MSG = 'Duplicate asset type name in import file';

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

function buildAssetCodeMap(assets) {
  const map = new Map();
  (assets || []).forEach((a) => {
    const code = a?.asset_code != null ? String(a.asset_code).trim().toLowerCase() : '';
    if (code) map.set(code, a);
  });
  return map;
}

function buildRfidMap(assets) {
  const map = new Map();
  (assets || []).forEach((a) => {
    const tag = normalizeRfidTag(a?.rfid_tag);
    if (tag) map.set(tag, a);
  });
  return map;
}

function appendImportRowError(row, message) {
  if (!row._errors) row._errors = [];
  if (!row._errors.includes(message)) row._errors.push(message);
  row._status = 'error';
}

/** Flag duplicate RFID / Asset ID within one preview or execute batch. */
function markImportRowDuplicates(rows) {
  const rfidSeen = new Map();
  const codeSeen = new Map();

  rows.forEach((row, index) => {
    const code = row.asset_code != null ? String(row.asset_code).trim().toLowerCase() : '';
    if (code) {
      if (codeSeen.has(code)) {
        appendImportRowError(row, ASSET_CODE_DUP_FILE_MSG);
        appendImportRowError(rows[codeSeen.get(code)], ASSET_CODE_DUP_FILE_MSG);
      } else {
        codeSeen.set(code, index);
      }
    }

    const rfid = normalizeRfidTag(row.rfid_tag);
    if (isValidRfidTag(rfid)) {
      if (rfidSeen.has(rfid)) {
        appendImportRowError(row, RFID_DUP_FILE_MSG);
        appendImportRowError(rows[rfidSeen.get(rfid)], RFID_DUP_FILE_MSG);
      } else {
        rfidSeen.set(rfid, index);
      }
    }
  });
}

/** Flag duplicate asset type names within one import batch (names are globally unique). */
function markAssetTypeNameDuplicatesInFile(rows) {
  const seen = new Map();
  rows.forEach((row, index) => {
    const key = row.name != null ? String(row.name).trim().toLowerCase() : '';
    if (!key) return;
    if (seen.has(key)) {
      appendImportRowError(row, ASSET_TYPE_DUP_FILE_MSG);
      appendImportRowError(rows[seen.get(key)], ASSET_TYPE_DUP_FILE_MSG);
    } else {
      seen.set(key, index);
    }
  });
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function ymdIfValid(y, m, d) {
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Normalize a spreadsheet date cell to YYYY-MM-DD (the format date attributes are stored in).
 * Accepts Excel serial numbers, ISO dates, DD/MM/YYYY (or MM/DD/YYYY when unambiguous), and
 * textual dates like "15 Mar 2025". Returns null when the value is not a recognizable date.
 */
function normalizeImportDate(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // Excel serial date (days since 1899-12-30); optional fractional time part.
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    if (serial < 1 || serial > 2958465) return null;
    const dt = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
    return ymdIfValid(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }

  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (m) return ymdIfValid(Number(m[1]), Number(m[2]), Number(m[3]));

  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:\s.*)?$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    let y = Number(m[3]);
    if (m[3].length === 2) y += y >= 70 ? 1900 : 2000;
    // Day-first unless the second part can only be a day.
    if (b > 12 && a <= 12) return ymdIfValid(y, a, b);
    return ymdIfValid(y, b, a);
  }

  if (/[a-z]/i.test(s)) {
    const t = Date.parse(s);
    if (!Number.isNaN(t)) {
      const dt = new Date(t);
      return ymdIfValid(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
    }
  }
  return null;
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
    asset_code: row.asset_code,
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
    _nameFix: row._nameFix,
    _notes: row._notes,
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
  buildAssetCodeMap,
  buildRfidMap,
  markImportRowDuplicates,
  markAssetTypeNameDuplicatesInFile,
  ASSET_TYPE_DUP_FILE_MSG,
  normalizeImportDate,
  findInNameMap,
  resolveMasterIdFromMaps,
  slimAssetPreviewRow,
  slimLocationPreviewRow,
  slimAssetTypePreviewRow,
  withTransaction,
};
