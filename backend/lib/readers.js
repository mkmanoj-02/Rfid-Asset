/**
 * Shared readers helpers: serialize, validate, antenna rebuild.
 */

const db = require('../db');
const { isoSql } = require('./rfidTime');

const READER_TYPES = new Set(['IR-Reader', '4-Port Reader']);
const MODES = new Set(['IN', 'OUT', 'MONITORING']);

const READER_SELECT = `SELECT r.*, ${isoSql('r.last_seen')} AS last_seen_iso FROM readers r`;

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
    rxSensitivity: row.rx_sensitivity,
    enabled: Boolean(row.enabled),
  };
}

function serializeReader(row, antennas = []) {
  return {
    id: row.id,
    name: row.name,
    readerType: row.reader_type,
    ipAddress: row.ip_address,
    port: row.port,
    enabled: Boolean(row.enabled),
    mode: row.mode,
    antennaCount: row.antenna_count,
    txPower: row.tx_power,
    sameTxPower: Boolean(row.same_tx_power),
    readDuration: row.read_duration,
    itemSeen: row.item_seen,
    itemSeenEnabled: Boolean(row.item_seen_enabled),
    itemIn: row.item_in,
    itemOut: row.item_out,
    status: row.status,
    connectionStatus: row.connection_status,
    lastSeen: row.last_seen_iso || null,
    tagsReadCount: Number(row.tags_read_count || 0),
    error: row.last_error || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    antennas: antennas.map(serializeAntenna),
  };
}

const ANTENNA_COLUMNS = 'id, reader_id, number, tx_power, rx_sensitivity, enabled';

async function getAntennasForReader(readerId, conn = db) {
  const [rows] = await conn.query(
    `SELECT ${ANTENNA_COLUMNS} FROM reader_antennas WHERE reader_id = ? ORDER BY number ASC`,
    [readerId]
  );
  return rows;
}

async function getReaderRow(id, conn = db) {
  const [rows] = await conn.query(`${READER_SELECT} WHERE r.id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}

async function getReaderWithAntennas(id, conn = db) {
  const row = await getReaderRow(id, conn);
  if (!row) return null;
  const antennas = await getAntennasForReader(id, conn);
  return serializeReader(row, antennas);
}

async function listReadersWithAntennas(conn = db) {
  const [rows] = await conn.query(`${READER_SELECT} ORDER BY r.name ASC`);
  if (!rows.length) return [];
  const [antennas] = await conn.query(
    `SELECT ${ANTENNA_COLUMNS} FROM reader_antennas ORDER BY reader_id ASC, number ASC`
  );
  const byReader = new Map(rows.map((r) => [r.id, []]));
  for (const a of antennas) byReader.get(a.reader_id)?.push(a);
  return rows.map((r) => serializeReader(r, byReader.get(r.id) || []));
}

function invalid(error, field) {
  return { error, field, status: 400 };
}

function optionalNonNegInt(body, camel, snake, fallback, label, field) {
  const v = toInt(pick(body, camel, snake), fallback);
  if (v !== undefined && (!Number.isInteger(v) || v < 0)) {
    return { error: invalid(`${label} must be a non-negative integer`, field) };
  }
  return { value: v };
}

function optionalBool(body, camel, snake, isCreate, createDefault) {
  const raw = pick(body, camel, snake);
  if (raw !== undefined) return toBool(raw, createDefault);
  return isCreate ? createDefault : undefined;
}

/**
 * Parse and validate create/update body. Runtime fields (status, connectionStatus,
 * lastSeen, tagsReadCount, error) are never read from the body.
 * @returns {{ data: object } | { error: string, field?: string, status: number }}
 */
async function parseReaderSaveBody(body, { isCreate }) {
  const name = String(pick(body, 'name', 'name') ?? '').trim();
  const ipAddress = String(pick(body, 'ipAddress', 'ip_address') ?? '').trim();

  if (!name && !ipAddress) return invalid('Name and IP address are required.', 'name');
  if (!name) return invalid('Name is required.', 'name');
  if (!ipAddress) return invalid('IP address is required.', 'ipAddress');
  if (name.length > 128) return invalid('Name is too long (max 128 characters).', 'name');
  if (ipAddress.length > 64) return invalid('IP address is too long (max 64 characters).', 'ipAddress');

  const readerTypeRaw = pick(body, 'readerType', 'reader_type');
  const readerType = readerTypeRaw != null ? String(readerTypeRaw).trim() : (isCreate ? '' : undefined);
  if (isCreate && !readerType) return invalid('Reader type is required.', 'readerType');
  if (readerType !== undefined && readerType !== '' && !READER_TYPES.has(readerType)) {
    return invalid('Reader type must be IR-Reader or 4-Port Reader.', 'readerType');
  }

  const port = toInt(pick(body, 'port', 'port'), isCreate ? 2022 : undefined);
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    return invalid('Port must be an integer between 1 and 65535.', 'port');
  }

  const modeRaw = pick(body, 'mode', 'mode');
  const mode = modeRaw !== undefined ? String(modeRaw).trim().toUpperCase() : (isCreate ? 'IN' : undefined);
  if (mode !== undefined && !MODES.has(mode)) {
    return invalid('Mode must be IN, OUT, or MONITORING.', 'mode');
  }

  const antennaCount = toInt(pick(body, 'antennaCount', 'antenna_count'), isCreate ? 4 : undefined);
  if (antennaCount !== undefined && (!Number.isInteger(antennaCount) || antennaCount < 1 || antennaCount > 32)) {
    return invalid('Antenna count must be between 1 and 32.', 'antennaCount');
  }

  const txPower = toInt(pick(body, 'txPower', 'tx_power'), isCreate ? 30 : undefined);
  if (txPower !== undefined && !Number.isInteger(txPower)) {
    return invalid('TX power must be an integer.', 'txPower');
  }

  const numbers = {};
  for (const [camel, snake, def, label] of [
    ['readDuration', 'read_duration', 1000, 'Read duration'],
    ['itemSeen', 'item_seen', 20000, 'Item seen'],
    ['itemIn', 'item_in', 20000, 'Item in'],
    ['itemOut', 'item_out', 20000, 'Item out'],
  ]) {
    const r = optionalNonNegInt(body, camel, snake, isCreate ? def : undefined, label, camel);
    if (r.error) return r.error;
    numbers[camel] = r.value;
  }

  const antennas = pick(body, 'antennas', 'antennas');
  if (antennas !== undefined && antennas !== null && !Array.isArray(antennas)) {
    return invalid('antennas must be an array.', 'antennas');
  }
  if (Array.isArray(antennas)) {
    for (const a of antennas) {
      if (!a || typeof a !== 'object') return invalid('Each antenna must be an object.', 'antennas');
      const tx = pick(a, 'txPower', 'tx_power');
      if (tx !== undefined && !Number.isInteger(toInt(tx, 0))) {
        return invalid('Antenna txPower must be an integer.', 'antennas');
      }
      const rx = pick(a, 'rxSensitivity', 'rx_sensitivity');
      if (rx !== undefined && !Number.isInteger(toInt(rx, 0))) {
        return invalid('Antenna rxSensitivity must be an integer.', 'antennas');
      }
    }
  }

  return {
    data: {
      name,
      ipAddress,
      readerType,
      port,
      enabled: optionalBool(body, 'enabled', 'enabled', isCreate, true),
      mode,
      antennaCount,
      txPower,
      sameTxPower: optionalBool(body, 'sameTxPower', 'same_tx_power', isCreate, false),
      readDuration: numbers.readDuration,
      itemSeen: numbers.itemSeen,
      itemSeenEnabled: optionalBool(body, 'itemSeenEnabled', 'item_seen_enabled', isCreate, true),
      itemIn: numbers.itemIn,
      itemOut: numbers.itemOut,
      antennas: Array.isArray(antennas) ? antennas : undefined,
    },
  };
}

/**
 * Rebuild antennas to match antennaCount: antennas above the count are removed,
 * the first antennaCount are upserted. With sameTxPower every antenna gets txPower.
 */
async function rebuildAntennas(conn, readerId, antennaCount, antennasInput, defaultTxPower, sameTxPower = false) {
  await conn.query(
    'DELETE FROM reader_antennas WHERE reader_id = ? AND number > ?',
    [readerId, antennaCount]
  );

  const [existing] = await conn.query(
    'SELECT id, number, tx_power, rx_sensitivity, enabled FROM reader_antennas WHERE reader_id = ?',
    [readerId]
  );
  const byNumber = new Map(existing.map((a) => [a.number, a]));

  const inputByNumber = new Map();
  if (Array.isArray(antennasInput)) {
    antennasInput.forEach((a, idx) => {
      const num = toInt(a.number ?? a.Number, idx + 1);
      if (Number.isInteger(num) && num >= 1 && num <= antennaCount) {
        inputByNumber.set(num, a);
      }
    });
  }

  for (let n = 1; n <= antennaCount; n++) {
    const input = inputByNumber.get(n);
    const prev = byNumber.get(n);
    const prevTx = prev?.tx_power ?? defaultTxPower;
    const txPower = sameTxPower
      ? defaultTxPower
      : input
        ? toInt(pick(input, 'txPower', 'tx_power'), prevTx)
        : prevTx;
    const prevRx = prev?.rx_sensitivity ?? -70;
    const rxSensitivity = input ? toInt(pick(input, 'rxSensitivity', 'rx_sensitivity'), prevRx) : prevRx;
    const prevEnabled = prev ? Boolean(prev.enabled) : true;
    const enabled = input ? toBool(pick(input, 'enabled', 'enabled'), prevEnabled) : prevEnabled;

    if (prev) {
      await conn.query(
        'UPDATE reader_antennas SET tx_power = ?, rx_sensitivity = ?, enabled = ? WHERE id = ?',
        [txPower, rxSensitivity, enabled ? 1 : 0, prev.id]
      );
    } else {
      await conn.query(
        `INSERT INTO reader_antennas
           (reader_id, number, tx_power, rx_sensitivity, enabled)
         VALUES (?, ?, ?, ?, ?)`,
        [readerId, n, txPower, rxSensitivity, enabled ? 1 : 0]
      );
    }
  }
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
  listReadersWithAntennas,
  parseReaderSaveBody,
  rebuildAntennas,
  READER_TYPES,
  MODES,
};
