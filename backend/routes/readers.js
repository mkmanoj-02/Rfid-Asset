const express = require('express');
const router = express.Router();
const db = require('../db');
const audit = require('../audit');
const {
  parseId,
  getReaderWithAntennas,
  getReaderRow,
  parseReaderSaveBody,
  rebuildAntennas,
  setConnectionStatus,
  parsePlacementBody,
  serializeAntenna,
} = require('../lib/readers');

async function ensureFloorPlanImageUrl() {
  const [rows] = await db.query(
    'SELECT image_url FROM floor_plans WHERE id = 1 LIMIT 1'
  );
  return rows[0]?.image_url || null;
}

// POST /api/readers/start-all — before /:id
router.post('/start-all', async (req, res) => {
  const [rows] = await db.query('SELECT id FROM readers');
  const ids = rows.map((r) => r.id);
  await setConnectionStatus(ids, 'CONNECTED');
  await audit.log(
    'Settings',
    'Modified',
    `Started all readers (${ids.length})`,
    req.auditUser,
    req.auditUserId
  );
  res.json({ message: 'All readers connected', count: ids.length });
});

// POST /api/readers/stop-all
router.post('/stop-all', async (req, res) => {
  const [rows] = await db.query('SELECT id FROM readers');
  const ids = rows.map((r) => r.id);
  await setConnectionStatus(ids, 'DISCONNECTED');
  await audit.log(
    'Settings',
    'Modified',
    `Stopped all readers (${ids.length})`,
    req.auditUser,
    req.auditUserId
  );
  res.json({ message: 'All readers disconnected', count: ids.length });
});

// GET /api/readers
router.get('/', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM readers ORDER BY name ASC');
  if (!rows.length) return res.json([]);

  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const [antennas] = await db.query(
    `SELECT id, reader_id, number, tx_power, enabled, placed, position_x, position_y
     FROM reader_antennas
     WHERE reader_id IN (${placeholders})
     ORDER BY reader_id ASC, number ASC`,
    ids
  );

  const byReader = new Map(ids.map((id) => [id, []]));
  for (const a of antennas) {
    byReader.get(a.reader_id)?.push(a);
  }

  const { serializeReader } = require('../lib/readers');
  res.json(rows.map((r) => serializeReader(r, byReader.get(r.id) || [])));
});

// GET /api/readers/:id
router.get('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) return res.status(404).json({ message: 'Reader not found' });

  const reader = await getReaderWithAntennas(id);
  if (!reader) return res.status(404).json({ message: 'Reader not found' });
  res.json(reader);
});

// POST /api/readers
router.post('/', async (req, res) => {
  const parsed = await parseReaderSaveBody(req.body, { isCreate: true });
  if (parsed.error) {
    return res.status(parsed.status).json({ message: parsed.error });
  }
  const d = parsed.data;

  const [dup] = await db.query(
    'SELECT id FROM readers WHERE LOWER(name) = LOWER(?) LIMIT 1',
    [d.name]
  );
  if (dup.length) {
    return res.status(409).json({ message: `Reader "${d.name}" already exists` });
  }

  const conn = await db.getConnection();
  let readerId;
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO readers (
         name, reader_type, ip_address, port, location, zone_type, mode,
         antenna_count, tx_power, read_duration, item_seen, item_seen_enabled
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        d.name,
        d.readerType,
        d.ipAddress,
        d.port,
        d.location || null,
        d.zoneType || null,
        d.mode,
        d.antennaCount,
        d.txPower,
        d.readDuration,
        d.itemSeen,
        d.itemSeenEnabled ? 1 : 0,
      ]
    );
    readerId = result.insertId;
    await rebuildAntennas(conn, readerId, d.antennaCount, d.antennas, d.txPower);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: `Reader "${d.name}" already exists` });
    }
    throw err;
  } finally {
    conn.release();
  }

  await audit.log(
    'Settings',
    'Added',
    `Reader "${d.name}" was created`,
    req.auditUser,
    req.auditUserId
  );

  const reader = await getReaderWithAntennas(readerId);
  res.status(201).json(reader);
});

// PUT /api/readers/:id
router.put('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) return res.status(404).json({ message: 'Reader not found' });

  const existing = await getReaderRow(id);
  if (!existing) return res.status(404).json({ message: 'Reader not found' });

  const parsed = await parseReaderSaveBody(req.body, { isCreate: false });
  if (parsed.error) {
    return res.status(parsed.status).json({ message: parsed.error });
  }
  const d = parsed.data;

  const [dup] = await db.query(
    'SELECT id FROM readers WHERE LOWER(name) = LOWER(?) AND id != ? LIMIT 1',
    [d.name, id]
  );
  if (dup.length) {
    return res.status(409).json({ message: `Reader "${d.name}" already exists` });
  }

  const readerType = d.readerType !== undefined && d.readerType !== ''
    ? d.readerType
    : existing.reader_type;
  const port = d.port !== undefined ? d.port : existing.port;
  const location = d.location !== undefined ? (d.location || null) : existing.location;
  const zoneType = d.zoneType !== undefined ? (d.zoneType || null) : existing.zone_type;
  const mode = d.mode !== undefined ? d.mode : existing.mode;
  const antennaCount = d.antennaCount !== undefined ? d.antennaCount : existing.antenna_count;
  const txPower = d.txPower !== undefined ? d.txPower : existing.tx_power;
  const readDuration = d.readDuration !== undefined ? d.readDuration : existing.read_duration;
  const itemSeen = d.itemSeen !== undefined ? d.itemSeen : existing.item_seen;
  const itemSeenEnabled =
    d.itemSeenEnabled !== undefined
      ? d.itemSeenEnabled
      : Boolean(existing.item_seen_enabled);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE readers SET
         name = ?, reader_type = ?, ip_address = ?, port = ?,
         location = ?, zone_type = ?, mode = ?,
         antenna_count = ?, tx_power = ?, read_duration = ?,
         item_seen = ?, item_seen_enabled = ?
       WHERE id = ?`,
      [
        d.name,
        readerType,
        d.ipAddress,
        port,
        location,
        zoneType,
        mode,
        antennaCount,
        txPower,
        readDuration,
        itemSeen,
        itemSeenEnabled ? 1 : 0,
        id,
      ]
    );
    await rebuildAntennas(conn, id, antennaCount, d.antennas, txPower);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: `Reader "${d.name}" already exists` });
    }
    throw err;
  } finally {
    conn.release();
  }

  await audit.log(
    'Settings',
    'Modified',
    `Reader "${d.name}" was updated`,
    req.auditUser,
    req.auditUserId
  );

  const reader = await getReaderWithAntennas(id);
  res.json(reader);
});

// DELETE /api/readers/:id
router.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) return res.status(404).json({ message: 'Reader not found' });

  const existing = await getReaderRow(id);
  if (!existing) return res.status(404).json({ message: 'Reader not found' });

  await db.query('DELETE FROM readers WHERE id = ?', [id]);

  await audit.log(
    'Settings',
    'Deleted',
    `Reader "${existing.name}" was deleted`,
    req.auditUser,
    req.auditUserId
  );

  res.status(204).send();
});

// POST /api/readers/:id/start
router.post('/:id/start', async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) return res.status(404).json({ message: 'Reader not found' });

  const existing = await getReaderRow(id);
  if (!existing) return res.status(404).json({ message: 'Reader not found' });

  await setConnectionStatus([id], 'CONNECTED');
  const reader = await getReaderWithAntennas(id);
  res.json(reader);
});

// POST /api/readers/:id/stop
router.post('/:id/stop', async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) return res.status(404).json({ message: 'Reader not found' });

  const existing = await getReaderRow(id);
  if (!existing) return res.status(404).json({ message: 'Reader not found' });

  await setConnectionStatus([id], 'DISCONNECTED');
  const reader = await getReaderWithAntennas(id);
  res.json(reader);
});

// PUT /api/readers/:id/placement
router.put('/:id/placement', async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) return res.status(404).json({ message: 'Reader not found' });

  const existing = await getReaderRow(id);
  if (!existing) return res.status(404).json({ message: 'Reader not found' });

  const parsed = parsePlacementBody(req.body);
  if (parsed.error) {
    return res.status(parsed.status).json({ message: parsed.error });
  }
  const { placed, positionX, positionY } = parsed.data;

  let floorPlan = existing.floor_plan;
  if (placed) {
    const imageUrl = await ensureFloorPlanImageUrl();
    if (imageUrl) floorPlan = imageUrl;
  }

  await db.query(
    `UPDATE readers SET placed = ?, position_x = ?, position_y = ?, floor_plan = ? WHERE id = ?`,
    [placed ? 1 : 0, positionX, positionY, floorPlan, id]
  );

  const reader = await getReaderWithAntennas(id);
  res.json(reader);
});

// PUT /api/readers/:id/antennas/:number/placement
router.put('/:id/antennas/:number/placement', async (req, res) => {
  const id = parseId(req.params.id);
  const number = parseId(req.params.number);
  if (id == null) return res.status(404).json({ message: 'Reader not found' });
  if (number == null) return res.status(404).json({ message: 'Antenna not found' });

  const existing = await getReaderRow(id);
  if (!existing) return res.status(404).json({ message: 'Reader not found' });

  const [antRows] = await db.query(
    'SELECT * FROM reader_antennas WHERE reader_id = ? AND number = ? LIMIT 1',
    [id, number]
  );
  if (!antRows.length) return res.status(404).json({ message: 'Antenna not found' });

  const parsed = parsePlacementBody(req.body);
  if (parsed.error) {
    return res.status(parsed.status).json({ message: parsed.error });
  }
  const { placed, positionX, positionY } = parsed.data;

  await db.query(
    `UPDATE reader_antennas SET placed = ?, position_x = ?, position_y = ? WHERE id = ?`,
    [placed ? 1 : 0, positionX, positionY, antRows[0].id]
  );

  const [updated] = await db.query(
    'SELECT * FROM reader_antennas WHERE id = ? LIMIT 1',
    [antRows[0].id]
  );
  res.json(serializeAntenna(updated[0]));
});

module.exports = router;
