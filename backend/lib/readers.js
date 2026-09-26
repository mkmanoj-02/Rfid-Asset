/**
 * Shared readers helpers: serialize, validate, antenna rebuild, placement.
 */

const db = require('../db');

const READER_TYPES = new Set(['IR-Reader', '4-Port Reader']);
const MODES = new Set(['IN', 'OUT', 'MONITORING']);
const CONNECTION_STATUSES = new Set(['CONNECTED', 'DISCONNECTED']);

function parseId(param) {
  const id = parseInt(param, 10);
  if (!Number.isInteger(id) || id < 1 || String(id) !== String(param).trim()) return null;
  return id;
}

function pick(body, camel, snake) {
  if (body == null) return undefined;
  if (Object.prototype.hasOwnProperty.call(body, camel)) return body[camel];
  if (Object.prototype.hasOwnProperty.call(body, snake)) return body[snake];
  return undefined;
}

function toBool(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return Boolean(value);
}

function toInt(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n);
}

function serializeAntenna(row) {
  return {
    id: row.id,
    readerId: row.reader_id,
    number: row.number,
    txPower: row.tx_power,
    enabled: Boolean(row.enabled),
    placed: Boolean(row.placed),
    positionX: row.position_x,
    positionY: row.position_y,
  };
}

function serializeReader(row, antennas = []) {
  return {
    id: row.id,
    name: row.name,
    readerType: row.reader_type,
    ipAddress: row.ip_address,
    port: row.port,
    location: row.location || '',
    zoneType: row.zone_type || '',
    mode: row.mode,
    antennaCount: row.antenna_count,
    txPower: row.tx_power,
    readDuration: row.read_duration,
    itemSeen: row.item_seen,
    itemSeenEnabled: Boolean(row.item_seen_enabled),
    connectionStatus: row.connection_status,
    placed: Boolean(row.placed),
    positionX: row.position_x,
    positionY: row.position_y,
    floorPlan: row.floor_plan || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    antennas: antennas.map(serializeAntenna),
  };
}

async function getAntennasForReader(readerId, conn = db) {
  const [rows] = await conn.query(
    `SELECT id, reader_id, number, tx_power, enabled, placed, position_x, position_y
     FROM reader_antennas
     WHERE reader_id = ?
     ORDER BY number ASC`,
    [readerId]
  );
  return rows;
}

async function getReaderRow(id, conn = db) {
  const [rows] = await conn.query('SELECT * FROM readers WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

async function getReaderWithAntennas(id, conn = db) {
  const row = await getReaderRow(id, conn);
  if (!row) return null;
  const antennas = await getAntennasForReader(id, conn);
  return serializeReader(row, antennas);
}

async function catalogNameExists(table, name) {
  const [rows] = await db.query(
    `SELECT id FROM ${table} WHERE LOWER(name) = LOWER(?) LIMIT 1`,
    [name]
  );
  return rows.length > 0;
}

/**
 * Parse and validate create/update body. Does not include placement or connection_status.
 * @returns {{ data: object } | { error: string, status: number }}
 */
async function parseReaderSaveBody(body, { isCreate }) {
  const name = String(pick(body, 'name', 'name') ?? '').trim();
  const ipAddress = String(pick(body, 'ipAddress', 'ip_address') ?? '').trim();

  if (!name) return { error: 'Name is required', status: 400 };
  if (!ipAddress) return { error: 'IP address is required', status: 400 };
  if (name.length > 120) return { error: 'Name is too long (max 120 characters)', status: 400 };

  const readerTypeRaw = pick(body, 'readerType', 'reader_type');
  const readerType = readerTypeRaw != null ? String(readerTypeRaw).trim() : (isCreate ? '' : undefined);
  if (isCreate && !readerType) return { error: 'Reader type is required', status: 400 };
  if (readerType !== undefined && readerType !== '' && !READER_TYPES.has(readerType)) {
    return { error: 'Reader type must be IR-Reader or 4-Port Reader', status: 400 };
  }

  const port = toInt(pick(body, 'port', 'port'), isCreate ? 2022 : undefined);
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    return { error: 'Port must be an integer between 1 and 65535', status: 400 };
  }

  let location = pick(body, 'location', 'location');
  if (location !== undefined) {
    location = String(location ?? '').trim();
    if (location && !(await catalogNameExists('reader_locations', location))) {
      return { error: `Unknown location "${location}"`, status: 400 };
    }
  }

  let zoneType = pick(body, 'zoneType', 'zone_type');
  if (zoneType !== undefined) {
    zoneType = String(zoneType ?? '').trim();
    if (zoneType && !(await catalogNameExists('zones', zoneType))) {
      return { error: `Unknown zone "${zoneType}"`, status: 400 };
    }
  }

  const modeRaw = pick(body, 'mode', 'mode');
  let mode = modeRaw !== undefined ? String(modeRaw).trim().toUpperCase() : (isCreate ? 'IN' : undefined);
  if (mode !== undefined && !MODES.has(mode)) {
    return { error: 'Mode must be IN, OUT, or MONITORING', status: 400 };
  }

  const antennaCount = toInt(pick(body, 'antennaCount', 'antenna_count'), isCreate ? 4 : undefined);
  if (antennaCount !== undefined && (!Number.isInteger(antennaCount) || antennaCount < 1 || antennaCount > 32)) {
    return { error: 'Antenna count must be between 1 and 32', status: 400 };
  }

  const txPower = toInt(pick(body, 'txPower', 'tx_power'), isCreate ? 30 : undefined);
  if (txPower !== undefined && !Number.isInteger(txPower)) {
    return { error: 'TX power must be an integer', status: 400 };
  }

  const readDuration = toInt(pick(body, 'readDuration', 'read_duration'), isCreate ? 1000 : undefined);
  if (readDuration !== undefined && (!Number.isInteger(readDuration) || readDuration < 0)) {
    return { error: 'Read duration must be a non-negative integer', status: 400 };
  }

  const itemSeen = toInt(pick(body, 'itemSeen', 'item_seen'), isCreate ? 20 : undefined);
  if (itemSeen !== undefined && (!Number.isInteger(itemSeen) || itemSeen < 0)) {
    return { error: 'Item seen must be a non-negative integer', status: 400 };
  }

  const itemSeenEnabledRaw = pick(body, 'itemSeenEnabled', 'item_seen_enabled');
  const itemSeenEnabled =
    itemSeenEnabledRaw !== undefined
      ? toBool(itemSeenEnabledRaw, true)
      : isCreate
        ? true
        : undefined;

  const antennas = pick(body, 'antennas', 'antennas');

  return {
    data: {
      name,
      ipAddress,
      readerType,
      port,
      location,
      zoneType,
      mode,
      antennaCount,
      txPower,
      readDuration,
      itemSeen,
      itemSeenEnabled,
      antennas: Array.isArray(antennas) ? antennas : undefined,
    },
  };
}

/**
 * Rebuild antennas to match antennaCount, keeping rows that still fit.
 * Applies optional antennas[] overrides for number / txPower / enabled.
 */
async function rebuildAntennas(conn, readerId, antennaCount, antennasInput, defaultTxPower) {
  await conn.query(
    'DELETE FROM reader_antennas WHERE reader_id = ? AND number > ?',
    [readerId, antennaCount]
  );

  const [existing] = await conn.query(
    'SELECT id, number, tx_power, enabled, placed, position_x, position_y FROM reader_antennas WHERE reader_id = ?',
    [readerId]
  );
  const byNumber = new Map(existing.map((a) => [a.number, a]));

  const inputByNumber = new Map();
  if (Array.isArray(antennasInput)) {
    for (const a of antennasInput) {
      const num = toInt(a.number ?? a.Number, null);
      if (Number.isInteger(num) && num >= 1 && num <= antennaCount) {
        inputByNumber.set(num, a);
      }
    }
  }

  for (let n = 1; n <= antennaCount; n++) {
    const input = inputByNumber.get(n);
    const prev = byNumber.get(n);
    const txPower = input
      ? toInt(pick(input, 'txPower', 'tx_power'), prev?.tx_power ?? defaultTxPower)
      : (prev?.tx_power ?? defaultTxPower);
    const enabled = input
      ? toBool(pick(input, 'enabled', 'enabled'), prev ? Boolean(prev.enabled) : true)
      : (prev ? Boolean(prev.enabled) : true);

    if (prev) {
      await conn.query(
        'UPDATE reader_antennas SET tx_power = ?, enabled = ? WHERE id = ?',
        [txPower, enabled ? 1 : 0, prev.id]
      );
    } else {
      await conn.query(
        `INSERT INTO reader_antennas
           (reader_id, number, tx_power, enabled, placed, position_x, position_y)
         VALUES (?, ?, ?, ?, 0, 0, 0)`,
        [readerId, n, txPower, enabled ? 1 : 0]
      );
    }
  }
}

async function setConnectionStatus(ids, status) {
  if (!CONNECTION_STATUSES.has(status)) throw new Error('Invalid connection status');
  if (!ids.length) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const [result] = await db.query(
    `UPDATE readers SET connection_status = ? WHERE id IN (${placeholders})`,
    [status, ...ids]
  );
  return result.affectedRows || 0;
}

function parsePlacementBody(body) {
  const placedRaw = pick(body, 'placed', 'placed');
  if (placedRaw === undefined) {
    return { error: 'placed is required', status: 400 };
  }
  const placed = toBool(placedRaw, false);
  let positionX = toInt(pick(body, 'positionX', 'position_x'), placed ? 0 : 0);
  let positionY = toInt(pick(body, 'positionY', 'position_y'), placed ? 0 : 0);

  if (!placed) {
    positionX = 0;
    positionY = 0;
  }

  if (!Number.isInteger(positionX) || !Number.isInteger(positionY)) {
    return { error: 'positionX and positionY must be integers', status: 400 };
  }

  return { data: { placed, positionX, positionY } };
}

module.exports = {
  parseId,
  pick,
  toBool,
  toInt,
  serializeReader,
  serializeAntenna,
  getReaderRow,
  getReaderWithAntennas,
  getAntennasForReader,
  parseReaderSaveBody,
  rebuildAntennas,
  setConnectionStatus,
  parsePlacementBody,
  READER_TYPES,
  MODES,
};
