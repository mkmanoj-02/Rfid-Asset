const express = require('express');
const router = express.Router();
const db = require('../db');
const audit = require('../audit');
const {
  ok,
  validationError,
  notFound,
  conflict,
  envelopeNotFound,
  envelopeErrorHandler,
} = require('../lib/apiEnvelope');
const {
  parseId,
  getReaderWithAntennas,
  getReaderRow,
  listReadersWithAntennas,
  parseReaderSaveBody,
  rebuildAntennas,
} = require('../lib/readers');

function throwIfInvalid(parsed) {
  if (parsed.error) throw validationError(parsed.error, parsed.field);
  return parsed.data;
}

async function requireReader(param) {
  const id = parseId(param);
  if (id == null) throw notFound('Reader not found');
  const existing = await getReaderRow(id);
  if (!existing) throw notFound('Reader not found');
  return existing;
}

async function assertNameFree(name, exceptId = null) {
  const [dup] = await db.query(
    'SELECT id FROM readers WHERE LOWER(name) = LOWER(?) AND id <> ? LIMIT 1',
    [name, exceptId || 0]
  );
  if (dup.length) throw conflict(`A reader named ${name} already exists`);
}

async function inTransaction(fn) {
  const conn = await db.getConnection();
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

// GET /api/readers
router.get('/', async (req, res) => {
  ok(res, 'Success', { readers: await listReadersWithAntennas() });
});

// GET /api/readers/:id
router.get('/:id', async (req, res) => {
  const existing = await requireReader(req.params.id);
  ok(res, 'Success', await getReaderWithAntennas(existing.id));
});

// POST /api/readers
router.post('/', async (req, res) => {
  const d = throwIfInvalid(await parseReaderSaveBody(req.body, { isCreate: true }));
  await assertNameFree(d.name);

  let readerId;
  try {
    readerId = await inTransaction(async (conn) => {
      const [result] = await conn.query(
        `INSERT INTO readers (
           name, reader_type, ip_address, port, enabled, mode,
           antenna_count, tx_power, same_tx_power, read_duration,
           item_seen, item_seen_enabled, item_in, item_out,
           status, connection_status, tags_read_count
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'STOPPED', 'DISCONNECTED', 0)`,
        [
          d.name, d.readerType, d.ipAddress, d.port, d.enabled ? 1 : 0, d.mode,
          d.antennaCount, d.txPower, d.sameTxPower ? 1 : 0, d.readDuration,
          d.itemSeen, d.itemSeenEnabled ? 1 : 0, d.itemIn, d.itemOut,
        ]
      );
      await rebuildAntennas(conn, result.insertId, d.antennaCount, d.antennas, d.txPower, d.sameTxPower);
      return result.insertId;
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw conflict(`A reader named ${d.name} already exists`);
    throw err;
  }

  await audit.log('Settings', 'Added', `Reader "${d.name}" was created`, req.auditUser, req.auditUserId);
  ok(res, 'Reader created', await getReaderWithAntennas(readerId), 201);
});

// PUT /api/readers/:id â€” runtime fields are never changed here
router.put('/:id', async (req, res) => {
  const existing = await requireReader(req.params.id);
  const id = existing.id;
  const d = throwIfInvalid(await parseReaderSaveBody(req.body, { isCreate: false }));
  await assertNameFree(d.name, id);

  const keep = (value, current) => (value !== undefined ? value : current);
  const readerType = d.readerType ? d.readerType : existing.reader_type;
  const antennaCount = keep(d.antennaCount, existing.antenna_count);
  const txPower = keep(d.txPower, existing.tx_power);
  const sameTxPower = keep(d.sameTxPower, Boolean(existing.same_tx_power));

  try {
    await inTransaction(async (conn) => {
      await conn.query(
        `UPDATE readers SET
           name = ?, reader_type = ?, ip_address = ?, port = ?, enabled = ?, mode = ?,
           antenna_count = ?, tx_power = ?, same_tx_power = ?, read_duration = ?,
           item_seen = ?, item_seen_enabled = ?, item_in = ?, item_out = ?
         WHERE id = ?`,
        [
          d.name, readerType, d.ipAddress, keep(d.port, existing.port),
          keep(d.enabled, Boolean(existing.enabled)) ? 1 : 0,
          keep(d.mode, existing.mode),
          antennaCount, txPower, sameTxPower ? 1 : 0, keep(d.readDuration, existing.read_duration),
          keep(d.itemSeen, existing.item_seen),
          keep(d.itemSeenEnabled, Boolean(existing.item_seen_enabled)) ? 1 : 0,
          keep(d.itemIn, existing.item_in), keep(d.itemOut, existing.item_out),
          id,
        ]
      );
      await rebuildAntennas(conn, id, antennaCount, d.antennas, txPower, sameTxPower);
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw conflict(`A reader named ${d.name} already exists`);
    throw err;
  }

  await audit.log('Settings', 'Modified', `Reader "${d.name}" was updated`, req.auditUser, req.auditUserId);
  ok(res, 'Reader updated', await getReaderWithAntennas(id));
});

// DELETE /api/readers/:id â€” antennas and floor placements cascade; tag history is kept
router.delete('/:id', async (req, res) => {
  const existing = await requireReader(req.params.id);
  await db.query('DELETE FROM readers WHERE id = ?', [existing.id]);
  await audit.log('Settings', 'Deleted', `Reader "${existing.name}" was deleted`, req.auditUser, req.auditUserId);
  ok(res, 'Reader deleted', { deleted: existing.name });
});

router.use(envelopeNotFound);
router.use(envelopeErrorHandler);

module.exports = router;
