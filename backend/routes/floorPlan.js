const express = require('express');
const fs = require('fs').promises;
const router = express.Router();
const db = require('../db');
const audit = require('../audit');
const {
  publicUrlForStoredFile,
  diskPathFromImageUrl,
  ENTITY_UPLOAD_SUBDIR,
  handleMulterImageError,
  uploadImageMiddleware,
} = require('../helper/upload');
const { parseId, toBool, toInt } = require('../lib/readers');

const FLOOR_PLAN_SUBDIR = ENTITY_UPLOAD_SUBDIR.floor_plan;
const ZONE_DEFAULT_W = 220;
const ZONE_DEFAULT_H = 120;
const ZONE_ORIGIN = 80;
const ZONE_SHIFT = 24;

async function safeUnlinkFloorImage(imageUrl) {
  const diskPath = diskPathFromImageUrl(imageUrl);
  if (!diskPath) return;
  try {
    await fs.unlink(diskPath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

async function ensureFloorPlanRow() {
  await db.query('INSERT IGNORE INTO floor_plans (id, image_url) VALUES (1, NULL)');
  const [rows] = await db.query(
    'SELECT id, image_url FROM floor_plans WHERE id = 1 LIMIT 1'
  );
  return rows[0];
}

function serializeZone(row) {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    minimized: Boolean(row.minimized),
  };
}

async function getLayout() {
  const plan = await ensureFloorPlanRow();
  const [zones] = await db.query(
    `SELECT id, floor_plan_id, type, name, x, y, width, height, minimized
     FROM floor_zones
     WHERE floor_plan_id = 1
     ORDER BY id ASC`
  );
  return {
    imageUrl: plan.image_url || '',
    zones: zones.map(serializeZone),
  };
}

function requiredImageUpload(entityKey) {
  const multerMw = uploadImageMiddleware(entityKey);
  return (req, res, next) => {
    multerMw(req, res, (err) => {
      if (err) return handleMulterImageError(err, req, res, next);
      next();
    });
  };
}

// GET /api/floor-plan
router.get('/', async (req, res) => {
  res.json(await getLayout());
});

// POST /api/floor-plan/image
router.post('/image', requiredImageUpload('floor_plan'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'Image file is required' });
  }

  const plan = await ensureFloorPlanRow();
  const previous = plan.image_url || null;
  const imageUrl = publicUrlForStoredFile(FLOOR_PLAN_SUBDIR, req.file.filename);

  await db.query('UPDATE floor_plans SET image_url = ? WHERE id = 1', [imageUrl]);
  if (previous && previous !== imageUrl) {
    await safeUnlinkFloorImage(previous);
  }

  await audit.log(
    'Settings',
    'Modified',
    'Floor plan image uploaded',
    req.auditUser,
    req.auditUserId
  );

  res.json({ imageUrl });
});

// DELETE /api/floor-plan/image
router.delete('/image', async (req, res) => {
  const plan = await ensureFloorPlanRow();
  if (plan.image_url) {
    await safeUnlinkFloorImage(plan.image_url);
  }
  await db.query('UPDATE floor_plans SET image_url = NULL WHERE id = 1');

  await audit.log(
    'Settings',
    'Modified',
    'Floor plan image cleared',
    req.auditUser,
    req.auditUserId
  );

  res.status(204).send();
});

// POST /api/floor-plan/zones
router.post('/zones', async (req, res) => {
  const type = String(req.body?.type ?? '').trim().toUpperCase();
  if (type !== 'DOOR' && type !== 'BIN') {
    return res.status(400).json({ message: 'type must be DOOR or BIN' });
  }

  await ensureFloorPlanRow();

  const [countRows] = await db.query(
    'SELECT COUNT(*) AS cnt FROM floor_zones WHERE floor_plan_id = 1 AND type = ?',
    [type]
  );
  const count = Number(countRows[0].cnt) || 0;
  const index = count + 1;

  const baseName = type === 'DOOR' ? 'Door Zone' : 'Bin Zone';
  const name = index === 1 ? baseName : `${baseName} ${index}`;

  const [totalRows] = await db.query(
    'SELECT COUNT(*) AS cnt FROM floor_zones WHERE floor_plan_id = 1'
  );
  const total = Number(totalRows[0].cnt) || 0;
  const x = ZONE_ORIGIN + total * ZONE_SHIFT;
  const y = ZONE_ORIGIN + total * ZONE_SHIFT;

  const [result] = await db.query(
    `INSERT INTO floor_zones
       (floor_plan_id, type, name, x, y, width, height, minimized)
     VALUES (1, ?, ?, ?, ?, ?, ?, 0)`,
    [type, name, x, y, ZONE_DEFAULT_W, ZONE_DEFAULT_H]
  );

  const [rows] = await db.query(
    'SELECT * FROM floor_zones WHERE id = ? LIMIT 1',
    [result.insertId]
  );

  await audit.log(
    'Settings',
    'Added',
    `Floor zone "${name}" was created`,
    req.auditUser,
    req.auditUserId
  );

  res.status(201).json(serializeZone(rows[0]));
});

// PUT /api/floor-plan/zones/:id
router.put('/zones/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) return res.status(404).json({ message: 'Zone not found' });

  const [rows] = await db.query(
    'SELECT * FROM floor_zones WHERE id = ? AND floor_plan_id = 1 LIMIT 1',
    [id]
  );
  if (!rows.length) return res.status(404).json({ message: 'Zone not found' });

  const existing = rows[0];
  const body = req.body || {};

  let x = existing.x;
  let y = existing.y;
  let width = existing.width;
  let height = existing.height;
  let minimized = Boolean(existing.minimized);

  if (Object.prototype.hasOwnProperty.call(body, 'x')) {
    x = toInt(body.x, NaN);
    if (!Number.isInteger(x)) return res.status(400).json({ message: 'x must be an integer' });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'y')) {
    y = toInt(body.y, NaN);
    if (!Number.isInteger(y)) return res.status(400).json({ message: 'y must be an integer' });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'width')) {
    width = toInt(body.width, NaN);
    if (!Number.isInteger(width) || width < 1) {
      return res.status(400).json({ message: 'width must be a positive integer' });
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'height')) {
    height = toInt(body.height, NaN);
    if (!Number.isInteger(height) || height < 1) {
      return res.status(400).json({ message: 'height must be a positive integer' });
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'minimized')) {
    minimized = toBool(body.minimized, false);
  }

  await db.query(
    `UPDATE floor_zones SET x = ?, y = ?, width = ?, height = ?, minimized = ? WHERE id = ?`,
    [x, y, width, height, minimized ? 1 : 0, id]
  );

  const [updated] = await db.query(
    'SELECT * FROM floor_zones WHERE id = ? LIMIT 1',
    [id]
  );
  res.json(serializeZone(updated[0]));
});

// DELETE /api/floor-plan/zones/:id
router.delete('/zones/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) return res.status(404).json({ message: 'Zone not found' });

  const [rows] = await db.query(
    'SELECT name FROM floor_zones WHERE id = ? AND floor_plan_id = 1 LIMIT 1',
    [id]
  );
  if (!rows.length) return res.status(404).json({ message: 'Zone not found' });

  await db.query('DELETE FROM floor_zones WHERE id = ?', [id]);

  await audit.log(
    'Settings',
    'Deleted',
    `Floor zone "${rows[0].name}" was deleted`,
    req.auditUser,
    req.auditUserId
  );

  res.status(204).send();
});

// POST /api/floor-plan/save — copy image URL onto every reader
router.post('/save', async (req, res) => {
  const plan = await ensureFloorPlanRow();
  const imageUrl = plan.image_url || null;

  const [result] = await db.query(
    'UPDATE readers SET floor_plan = ?',
    [imageUrl]
  );

  await audit.log(
    'Settings',
    'Modified',
    'Floor plan layout saved to readers',
    req.auditUser,
    req.auditUserId
  );

  res.json({
    imageUrl: imageUrl || '',
    readersUpdated: result.affectedRows || 0,
  });
});

module.exports = router;
