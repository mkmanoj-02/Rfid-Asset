const express = require('express');
const router = express.Router();
const db = require('../db');
const {
  ok,
  validationError,
  notFound,
  envelopeNotFound,
  envelopeErrorHandler,
} = require('../lib/apiEnvelope');
const { toSqlUtc } = require('../lib/rfidTime');

const PRESENCE = new Set(['online', 'offline']);

// GET /api/reader-status — derived: online when CONNECTED or RUNNING
router.get('/', async (req, res) => {
  const [rows] = await db.query(
    `SELECT id, name,
            CASE WHEN connection_status = 'CONNECTED' OR status = 'RUNNING'
                 THEN 'online' ELSE 'offline' END AS status
       FROM readers
      ORDER BY id`
  );
  ok(res, 'Success', { readers: rows });
});

/** POST (first report) and PUT (later reports) are treated the same: upsert presence. */
async function reportPresence(req, res) {
  const body = req.body || {};
  const presence = String(body.status ?? '').trim().toLowerCase();
  if (!PRESENCE.has(presence)) throw validationError('status must be online or offline.', 'status');

  const hasName = body.name !== undefined && body.name !== null && String(body.name).trim() !== '';
  const name = hasName ? String(body.name).trim() : null;

  const conn = await db.getConnection();
  let targets;
  try {
    await conn.beginTransaction();
    const [rows] = hasName
      ? await conn.query('SELECT id, name FROM readers WHERE name = ? FOR UPDATE', [name])
      : await conn.query('SELECT id, name FROM readers ORDER BY id FOR UPDATE');
    if (hasName && !rows.length) {
      await conn.rollback();
      throw notFound(`Reader ${name} not found`);
    }
    targets = rows;

    if (targets.length) {
      const ids = targets.map((r) => r.id);
      if (presence === 'online') {
        await conn.query(
          `UPDATE readers
              SET status = 'RUNNING', connection_status = 'CONNECTED',
                  last_seen = UTC_TIMESTAMP(3), last_error = NULL
            WHERE id IN (?)`,
          [ids]
        );
      } else {
        await conn.query(
          `UPDATE readers
              SET status = 'STOPPED', connection_status = 'DISCONNECTED', last_error = NULL
            WHERE id IN (?)`,
          [ids]
        );
      }
      await conn.query(
        `INSERT INTO reader_status_log (reader_id, reader_name, presence, http_method, reported_at)
         VALUES ?`,
        [targets.map((r) => [r.id, r.name, presence, req.method, toSqlUtc(new Date())])]
      );
    }
    await conn.commit();
  } catch (err) {
    if (!err.httpStatus) await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }

  const message = hasName ? `${targets[0].name} is ${presence}` : `All readers are ${presence}`;
  ok(res, message, {
    readers: targets.map((r) => ({ id: r.id, name: r.name, status: presence })),
  });
}

router.post('/', reportPresence);
router.put('/', reportPresence);

router.use(envelopeNotFound);
router.use(envelopeErrorHandler);

module.exports = router;
