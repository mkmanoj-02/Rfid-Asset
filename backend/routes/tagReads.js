const express = require('express');
const router = express.Router();
const db = require('../db');
const { runRules } = require('../ruleEngine');
const {
  ok,
  validationError,
  envelopeNotFound,
  envelopeErrorHandler,
} = require('../lib/apiEnvelope');
const { parseBatch, ingestBatch, EVENT_TYPES } = require('../lib/rfidTagEvents');
const { isoSql, parseIso, toSqlUtc } = require('../lib/rfidTime');

async function recordFailedPost() {
  try {
    await db.query('UPDATE api_post_stats SET failed_posts = failed_posts + 1 WHERE id = 1');
  } catch (e) {
    console.error('[tag-reads] failed to update api_post_stats:', e.message);
  }
}

// POST /api/tag-reads — batch upload from the middleware service (1–100 reads)
router.post('/', async (req, res) => {
  let reads;
  try {
    reads = parseBatch(req.body);
  } catch (err) {
    await recordFailedPost();
    throw err;
  }

  const conn = await db.getConnection();
  let summary;
  try {
    await conn.beginTransaction();
    summary = await ingestBatch(conn, reads);
    await conn.query(
      `UPDATE api_post_stats
          SET successful_posts = successful_posts + 1,
              tags_posted = tags_posted + ?,
              last_post_at = UTC_TIMESTAMP(3)
        WHERE id = 1`,
      [summary.accepted]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    await recordFailedPost();
    throw err;
  } finally {
    conn.release();
  }

  if (summary.movementsLogged > 0) {
    setImmediate(() => runRules().catch((e) => console.error('Rule engine error:', e.message)));
  }

  ok(res, 'Tag reads saved', {
    accepted: summary.accepted,
    duplicates: summary.duplicates,
    assetsMatched: summary.assetsMatched,
    movementsLogged: summary.movementsLogged,
    unassignedTags: summary.unassignedTags,
    unknownReaders: summary.unknownReaders,
  });
});

function parseOptionalInt(value, field, { min = 0 } = {}) {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) {
    throw validationError(`${field} must be an integer${min > 0 ? ` of at least ${min}` : ' of 0 or more'}.`, field);
  }
  return n;
}

function parseOptionalTime(value, field) {
  if (value === undefined || value === '') return undefined;
  const d = parseIso(String(value));
  if (!d) throw validationError(`${field} must be an ISO 8601 date-time.`, field);
  return d;
}

function pointInZone(x, y, z) {
  return x >= z.pos_x && x <= z.pos_x + z.width && y >= z.pos_y && y <= z.pos_y + z.height;
}

/** Resolve floor / zone display values from floor placements (antenna first, then reader). */
async function buildLocator(readerNames) {
  if (!readerNames.length) return () => ({ floor: null, zone: null });

  const [placements] = await db.query(
    `SELECT p.id, p.floor_plan_id, p.placed, p.pos_x, p.pos_y, r.name AS reader_name,
            fp.name AS plan_name, fp.is_active, fp.sort_order
       FROM floor_placements p
       JOIN readers r ON r.id = p.reader_id
       JOIN floor_plans fp ON fp.id = p.floor_plan_id
      WHERE r.name IN (?)
      ORDER BY fp.is_active DESC, fp.sort_order, fp.created_at`,
    [readerNames]
  );
  if (!placements.length) return () => ({ floor: null, zone: null });

  const [antennas] = await db.query(
    'SELECT placement_id, antenna_number, pos_x, pos_y FROM floor_antenna_placements WHERE placement_id IN (?)',
    [placements.map((p) => p.id)]
  );
  const planIds = [...new Set(placements.map((p) => p.floor_plan_id))];
  const [zones] = await db.query(
    'SELECT floor_plan_id, name, pos_x, pos_y, width, height FROM floor_zones WHERE floor_plan_id IN (?) ORDER BY sort_order',
    [planIds]
  );

  const byReader = new Map();
  for (const p of placements) {
    const key = p.reader_name.toLowerCase();
    if (!byReader.has(key)) byReader.set(key, []);
    byReader.get(key).push(p);
  }

  const locate = (planId, planName, x, y) => {
    const zone = zones.find((z) => z.floor_plan_id === planId && pointInZone(x, y, z));
    return { floor: planName, zone: zone ? zone.name : null };
  };

  return (readerName, antennaPort) => {
    const list = byReader.get(String(readerName).toLowerCase()) || [];
    for (const p of list) {
      const a = antennas.find((x) => x.placement_id === p.id && x.antenna_number === antennaPort);
      if (a) return locate(p.floor_plan_id, p.plan_name, a.pos_x, a.pos_y);
    }
    for (const p of list) {
      if (p.placed) return locate(p.floor_plan_id, p.plan_name, p.pos_x, p.pos_y);
    }
    return { floor: null, zone: null };
  };
}

// GET /api/tag-reads — Live Tags (newest first)
router.get('/', async (req, res) => {
  const q = req.query;
  const readerId = parseOptionalInt(q.readerId, 'readerId', { min: 1 });
  const antennaPort = parseOptionalInt(q.antennaPort, 'antennaPort');
  const from = parseOptionalTime(q.from, 'from');
  const to = parseOptionalTime(q.to, 'to');
  if (from && to && from > to) throw validationError('from must be before to.', 'from');
  const limitRaw = parseOptionalInt(q.limit, 'limit', { min: 1 });
  const limit = Math.min(limitRaw ?? 100, 500);
  const offset = parseOptionalInt(q.offset, 'offset') ?? 0;

  let eventType;
  if (q.eventType !== undefined && q.eventType !== '') {
    eventType = String(q.eventType).trim().toUpperCase();
    if (!EVENT_TYPES.has(eventType)) throw validationError('eventType must be IN, OUT, or SEEN.', 'eventType');
  }

  const where = [];
  const args = [];
  if (readerId !== undefined) {
    const [[reader]] = await db.query('SELECT name FROM readers WHERE id = ?', [readerId]);
    if (!reader) return ok(res, 'Success', { total: 0, reads: [] });
    where.push('reader_name = ?');
    args.push(reader.name);
  }
  if (antennaPort !== undefined) {
    where.push('antenna_port = ?');
    args.push(antennaPort);
  }
  if (from) {
    where.push('event_time >= ?');
    args.push(toSqlUtc(from));
  }
  if (to) {
    where.push('event_time <= ?');
    args.push(toSqlUtc(to));
  }
  if (eventType) {
    where.push('event_type = ?');
    args.push(eventType);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM tag_events ${whereSql}`, args);
  const [rows] = await db.query(
    `SELECT id, tid, epc, antenna_port, rssi, reader_name, ${isoSql('event_time')} AS event_time_iso,
            posted_to_server, event_type
       FROM tag_events ${whereSql}
      ORDER BY event_time DESC, id DESC
      LIMIT ? OFFSET ?`,
    [...args, limit, offset]
  );

  const locator = await buildLocator([...new Set(rows.map((r) => r.reader_name))]);
  const reads = rows.map((r) => {
    const { floor, zone } = locator(r.reader_name, r.antenna_port);
    return {
      id: r.id,
      tid: r.tid,
      epc: r.epc,
      antennaPort: r.antenna_port,
      rssi: r.rssi,
      readerName: r.reader_name,
      floor,
      zone,
      antenna: r.antenna_port > 0 ? `Antenna ${r.antenna_port}` : null,
      timestamp: r.event_time_iso,
      postedToServer: Boolean(r.posted_to_server),
      eventType: r.event_type,
    };
  });

  ok(res, 'Success', { total: Number(total), limit, offset, reads });
});

router.use(envelopeNotFound);
router.use(envelopeErrorHandler);

module.exports = router;
