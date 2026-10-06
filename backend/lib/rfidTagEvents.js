/**
 * Tag read ingestion (POST /api/tag-reads) and asset integration.
 *
 * - tag_events: INSERT IGNORE on uk_tag_event (reader_name, tid, event_type, event_time)
 *   so repeated batches from the middleware service are idempotent.
 * - Known tag (assets.rfid_tag = epc or tid): rfid_last_seen_at is updated for every
 *   accepted read; IN / OUT also add a movement_history row at the asset's current
 *   location (the location is never changed by a tag read).
 * - Unknown 24-character EPC: recorded once in unassigned_tags (source 'fixed-reader');
 *   an existing unassigned row from another source is left untouched.
 */

const { validationError } = require('./apiEnvelope');
const { parseIso, toSqlUtc } = require('./rfidTime');
const { isValidRfidTag } = require('./rfidMovements');

const MAX_BATCH = 100;
const EVENT_TYPES = new Set(['IN', 'OUT', 'SEEN']);
const MODES = new Set(['IN', 'OUT', 'MONITORING']);
const UNASSIGNED_SOURCE = 'fixed-reader';

function str(value, field, { required = false, max = 128 } = {}) {
  if (value === undefined || value === null) {
    if (required) throw validationError(`${field} is required.`, field);
    return '';
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw validationError(`${field} must be a string.`, field);
  }
  const s = String(value).trim();
  if (required && !s) throw validationError(`${field} is required.`, field);
  if (s.length > max) throw validationError(`${field} is too long (max ${max} characters).`, field);
  return s;
}

function int(value, field, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) throw validationError(`${field} must be a number.`, field);
  return Math.round(n);
}

/** Validate the whole batch up front; any invalid read rejects the batch with 400. */
function parseBatch(body) {
  const reads = body && body.reads;
  if (!Array.isArray(reads)) throw validationError('reads must be an array.', 'reads');
  if (reads.length === 0) throw validationError('reads must contain at least one read.', 'reads');
  if (reads.length > MAX_BATCH) {
    throw validationError(`A batch can contain at most ${MAX_BATCH} reads.`, 'reads');
  }

  return reads.map((r, i) => {
    const at = (f) => `reads[${i}].${f}`;
    if (!r || typeof r !== 'object') throw validationError(`reads[${i}] must be an object.`, `reads[${i}]`);

    const eventType = str(r.eventType, at('eventType'), { required: true, max: 16 }).toUpperCase();
    if (!EVENT_TYPES.has(eventType)) {
      throw validationError('eventType must be IN, OUT, or SEEN.', at('eventType'));
    }
    const modeRaw = str(r.mode, at('mode'), { max: 32 }).toUpperCase();
    if (modeRaw && !MODES.has(modeRaw)) {
      throw validationError('mode must be IN, OUT, or MONITORING.', at('mode'));
    }
    const timestampRaw = str(r.timestamp, at('timestamp'), { required: true, max: 64 });
    const eventDate = parseIso(timestampRaw);
    if (!eventDate) throw validationError('timestamp must be an ISO 8601 date-time.', at('timestamp'));

    return {
      epc: str(r.epc, at('epc'), { required: true }),
      tid: str(r.tid, at('tid'), { required: true }),
      antennaPort: int(r.antennaPort, at('antennaPort'), 0),
      rssi: int(r.rssi, at('rssi'), 0),
      readerName: str(r.readerName, at('readerName'), { required: true }),
      readerType: str(r.readerType, at('readerType'), { max: 64 }),
      ipAddress: str(r.ipAddress, at('ipAddress'), { max: 64 }),
      mode: modeRaw,
      location: str(r.location, at('location')),
      zoneName: str(r.zoneName, at('zoneName')),
      previousZoneName: str(r.previousZoneName, at('previousZoneName')),
      eventType,
      eventDate,
    };
  });
}

function defaultMode(eventType) {
  if (eventType === 'IN') return 'IN';
  if (eventType === 'OUT') return 'OUT';
  return 'MONITORING';
}

/**
 * Insert a validated batch inside the caller's transaction.
 * @returns {Promise<{accepted:number, duplicates:number, assetsMatched:number, unassignedTags:number, unknownReaders:string[], movementsLogged:number}>}
 */
async function ingestBatch(conn, reads) {
  const names = [...new Set(reads.map((r) => r.readerName))];
  const [readerRows] = await conn.query(
    'SELECT id, name, reader_type, ip_address, mode FROM readers WHERE name IN (?)',
    [names]
  );
  const readerByName = new Map(readerRows.map((r) => [r.name.toLowerCase(), r]));

  const accepted = [];
  for (const r of reads) {
    const reader = readerByName.get(r.readerName.toLowerCase());
    const [result] = await conn.query(
      `INSERT IGNORE INTO tag_events
         (epc, tid, antenna_port, rssi, reader_name, reader_type, ip_address, mode,
          location, zone_name, previous_zone_name, event_type, event_time, posted_to_server, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, UTC_TIMESTAMP(3))`,
      [
        r.epc, r.tid, r.antennaPort, r.rssi, r.readerName,
        r.readerType || reader?.reader_type || '',
        r.ipAddress || reader?.ip_address || '',
        r.mode || reader?.mode || defaultMode(r.eventType),
        r.location, r.zoneName, r.previousZoneName,
        r.eventType, toSqlUtc(r.eventDate),
      ]
    );
    if (result.affectedRows === 1) accepted.push({ ...r, reader });
  }

  const perReader = new Map();
  for (const r of accepted) {
    if (r.reader) perReader.set(r.reader.id, (perReader.get(r.reader.id) || 0) + 1);
  }
  for (const [readerId, count] of perReader) {
    await conn.query(
      'UPDATE readers SET tags_read_count = tags_read_count + ?, last_seen = UTC_TIMESTAMP(3) WHERE id = ?',
      [count, readerId]
    );
  }

  const assetSummary = await linkAssets(conn, accepted);

  const unknownReaders = names.filter((n) => !readerByName.has(n.toLowerCase()));
  return {
    accepted: accepted.length,
    duplicates: reads.length - accepted.length,
    ...assetSummary,
    unknownReaders,
  };
}

async function linkAssets(conn, accepted) {
  const summary = { assetsMatched: 0, movementsLogged: 0, unassignedTags: 0 };
  if (!accepted.length) return summary;

  const tags = [...new Set(accepted.flatMap((r) => [r.epc, r.tid]))];
  const [assets] = await conn.query(
    'SELECT id, rfid_tag, current_location_id FROM assets WHERE rfid_tag IN (?)',
    [tags]
  );
  const assetByTag = new Map(assets.map((a) => [String(a.rfid_tag).trim().toLowerCase(), a]));

  const matchedIds = new Set();
  const unknownEpcs = new Map();

  for (const r of accepted) {
    const asset = assetByTag.get(r.epc.toLowerCase()) || assetByTag.get(r.tid.toLowerCase());
    if (!asset) {
      if (isValidRfidTag(r.epc) && !unknownEpcs.has(r.epc.toLowerCase())) {
        unknownEpcs.set(r.epc.toLowerCase(), r);
      }
      continue;
    }
    matchedIds.add(asset.id);

    const eventSql = toSqlUtc(r.eventDate);
    await conn.query(
      `UPDATE assets
          SET rfid_last_seen_at = GREATEST(COALESCE(rfid_last_seen_at, ?), ?),
              updated_at = updated_at
        WHERE id = ?`,
      [eventSql, eventSql, asset.id]
    );

    if (r.eventType === 'IN' || r.eventType === 'OUT') {
      const zone = r.zoneName ? ` · ${r.zoneName}` : '';
      await conn.query(
        `INSERT INTO movement_history (asset_id, from_location_id, to_location_id, moved_at, notes)
         VALUES (?, ?, ?, ?, ?)`,
        [
          asset.id,
          asset.current_location_id,
          asset.current_location_id,
          r.eventDate,
          `RFID reader ${r.eventType} · ${r.readerName}${zone}`,
        ]
      );
      summary.movementsLogged += 1;
    }
  }
  summary.assetsMatched = matchedIds.size;

  for (const r of unknownEpcs.values()) {
    const zoneName = r.zoneName || null;
    const [result] = await conn.query(
      `INSERT IGNORE INTO unassigned_tags (tag_value, source, reader_id, zone_id, notes)
       VALUES (?, ?, ?, (SELECT z.id FROM zones z WHERE z.name = ? LIMIT 1), ?)`,
      [r.epc, UNASSIGNED_SOURCE, r.readerName, zoneName, `Seen by ${r.readerName} (${r.eventType})`]
    );
    if (result.affectedRows === 1) summary.unassignedTags += 1;
  }

  return summary;
}

module.exports = { MAX_BATCH, EVENT_TYPES, parseBatch, ingestBatch };
