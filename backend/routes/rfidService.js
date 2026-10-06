const express = require('express');
const router = express.Router();
const db = require('../db');
const audit = require('../audit');
const { ok, conflict, envelopeNotFound, envelopeErrorHandler } = require('../lib/apiEnvelope');
const { isoSql } = require('../lib/rfidTime');

/**
 * Middleware service state (browser mode only). Persists the state machine in
 * service_state; it never starts or stops an OS process.
 *
 *   NOT_CREATED --POST /service--> STOPPED --start--> RUNNING --stop--> STOPPED
 *   STOPPED | RUNNING --DELETE /service--> NOT_CREATED
 */

const LABELS = { NOT_CREATED: 'Not created', STOPPED: 'Stopped', RUNNING: 'Running' };

async function readState(conn = db) {
  await conn.query(
    "INSERT IGNORE INTO service_state (id, status, updated_at) VALUES (1, 'NOT_CREATED', UTC_TIMESTAMP(3))"
  );
  const [[row]] = await conn.query(
    `SELECT status, ${isoSql('updated_at')} AS updated_iso FROM service_state WHERE id = 1`
  );
  return { status: row.status, label: LABELS[row.status] || row.status, updatedAt: row.updated_iso };
}

/** Atomically move from one of `from` to `to`; 409 with `message` otherwise. */
async function transition(req, res, { from, to, message, conflictMessage }) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await readState(conn);
    const [[row]] = await conn.query('SELECT status FROM service_state WHERE id = 1 FOR UPDATE');
    if (!from.includes(row.status)) {
      await conn.rollback();
      throw conflict(typeof conflictMessage === 'function' ? conflictMessage(row.status) : conflictMessage);
    }
    await conn.query('UPDATE service_state SET status = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = 1', [to]);
    await conn.commit();
  } catch (err) {
    if (!err.httpStatus) await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
  await audit.log('Settings', 'Modified', `RFID middleware service: ${message}`, req.auditUser, req.auditUserId);
  ok(res, message, await readState());
}

router.get('/', async (req, res) => {
  ok(res, 'Success', await readState());
});

router.post('/', (req, res) =>
  transition(req, res, {
    from: ['NOT_CREATED'],
    to: 'STOPPED',
    message: 'Service created',
    conflictMessage: 'Delete the current service before creating another.',
  })
);

router.post('/start', (req, res) =>
  transition(req, res, {
    from: ['STOPPED'],
    to: 'RUNNING',
    message: 'Service started',
    conflictMessage: (status) =>
      status === 'RUNNING' ? 'The service is already running.' : 'The service has not been created.',
  })
);

router.post('/stop', (req, res) =>
  transition(req, res, {
    from: ['RUNNING'],
    to: 'STOPPED',
    message: 'Service stopped',
    conflictMessage: 'The service is not running.',
  })
);

router.delete('/', (req, res) =>
  transition(req, res, {
    from: ['STOPPED', 'RUNNING'],
    to: 'NOT_CREATED',
    message: 'Service deleted',
    conflictMessage: 'The service has not been created.',
  })
);

router.use(envelopeNotFound);
router.use(envelopeErrorHandler);

module.exports = router;
