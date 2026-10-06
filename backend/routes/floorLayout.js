const express = require('express');
const fs = require('fs').promises;
const multer = require('multer');
const db = require('../db');
const audit = require('../audit');
const {
  ok,
  fail,
  validationError,
  notFound,
  envelopeNotFound,
  envelopeErrorHandler,
} = require('../lib/apiEnvelope');
const {
  newId,
  ensureDefaultPlan,
  getPlanRow,
  loadPlans,
  loadLayout,
  parseZones,
  parsePlacements,
  parseImageUrl,
  parsePlanName,
  writePlanContents,
  DEFAULT_PLAN_ID,
  DEFAULT_PLAN_NAME,
} = require('../lib/floorLayout');
const {
  uploadImageMiddleware,
  publicUrlForStoredFile,
  diskPathFromImageUrl,
  ENTITY_UPLOAD_SUBDIR,
} = require('../helper/upload');

const FLOOR_PLAN_SUBDIR = ENTITY_UPLOAD_SUBDIR.floor_plan;

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

/** Remove an uploaded floor image unless another plan still uses it. */
async function unlinkImageIfUnused(imageUrl) {
  if (!imageUrl) return;
  const [[{ n }]] = await db.query('SELECT COUNT(*) AS n FROM floor_plans WHERE image_url = ?', [imageUrl]);
  if (Number(n) > 0) return;
  const diskPath = diskPathFromImageUrl(imageUrl);
  if (!diskPath) return;
  try {
    await fs.unlink(diskPath);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[floor-plans] unlink failed:', err.message);
  }
}

function parsePlanId(value, field = 'id') {
  const id = String(value ?? '').trim();
  if (!id) throw validationError('Each plan needs an id.', field);
  if (id.length > 64) throw validationError('Plan id is too long (max 64 characters).', field);
  return id;
}

/* ------------------------------------------------------------------ */
/* /api/floor-layout                                                   */
/* ------------------------------------------------------------------ */

const layoutRouter = express.Router();

layoutRouter.get('/', async (req, res) => {
  ok(res, 'Success', await loadLayout());
});

layoutRouter.put('/', async (req, res) => {
  const body = req.body || {};
  if (!Array.isArray(body.plans) || body.plans.length === 0) {
    throw validationError('At least one floor plan is required.', 'plans');
  }
  const seenPlans = new Set();
  const seenZones = new Set();
  const plans = body.plans.map((p) => {
    if (!p || typeof p !== 'object') throw validationError('Each plan must be an object.', 'plans');
    const id = parsePlanId(p.id, 'plans.id');
    if (seenPlans.has(id)) throw validationError(`Duplicate plan id "${id}".`, 'plans.id');
    seenPlans.add(id);
    return {
      id,
      name: parsePlanName(p.name),
      imageUrl: parseImageUrl(p.imageUrl),
      zones: parseZones(p.zones, seenZones),
      placements: parsePlacements(p.placements),
    };
  });
  const activeId = String(body.activeId ?? '').trim();
  if (!seenPlans.has(activeId)) throw validationError('activeId must match a plan id.', 'activeId');

  const removedImages = await inTransaction(async (conn) => {
    const ids = plans.map((p) => p.id);
    const [removed] = await conn.query('SELECT id, image_url FROM floor_plans WHERE id NOT IN (?)', [ids]);
    if (removed.length) {
      await conn.query('DELETE FROM floor_plans WHERE id IN (?)', [removed.map((r) => r.id)]);
    }
    await conn.query('DELETE FROM floor_zones WHERE floor_plan_id IN (?)', [ids]);

    let order = 0;
    for (const p of plans) {
      await conn.query(
        `INSERT INTO floor_plans (id, name, image_url, is_active, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE
           name = VALUES(name), image_url = VALUES(image_url), is_active = VALUES(is_active),
           sort_order = VALUES(sort_order), updated_at = UTC_TIMESTAMP(3)`,
        [p.id, p.name, p.imageUrl, p.id === activeId ? 1 : 0, order++]
      );
      await writePlanContents(conn, p.id, p.zones, p.placements);
    }
    return removed.map((r) => r.image_url).filter(Boolean);
  });

  for (const url of removedImages) await unlinkImageIfUnused(url);
  await audit.log('Settings', 'Modified', `Floor layout saved (${plans.length} plan(s))`, req.auditUser, req.auditUserId);
  ok(res, 'Floor layout saved', await loadLayout());
});

layoutRouter.use(envelopeNotFound);
layoutRouter.use(envelopeErrorHandler);

/* ------------------------------------------------------------------ */
/* /api/floor-plans                                                    */
/* ------------------------------------------------------------------ */

const plansRouter = express.Router();

async function requirePlan(id) {
  const plan = await getPlanRow(String(id));
  if (!plan) throw notFound('Floor plan not found');
  return plan;
}

async function loadPlan(id) {
  const [plan] = await loadPlans(db, id);
  return plan || null;
}

plansRouter.post('/', async (req, res) => {
  const name = parsePlanName(req.body?.name);
  const id = newId();
  await inTransaction(async (conn) => {
    const [[{ nextOrder }]] = await conn.query(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS nextOrder FROM floor_plans'
    );
    await conn.query('UPDATE floor_plans SET is_active = 0, updated_at = UTC_TIMESTAMP(3) WHERE is_active = 1');
    await conn.query(
      `INSERT INTO floor_plans (id, name, image_url, is_active, sort_order, created_at, updated_at)
       VALUES (?, ?, '', 1, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [id, name, nextOrder]
    );
  });
  await audit.log('Settings', 'Added', `Floor plan "${name}" was created`, req.auditUser, req.auditUserId);
  ok(res, 'Floor plan created', await loadPlan(id), 201);
});

plansRouter.put('/:id', async (req, res) => {
  const existing = await requirePlan(req.params.id);
  const body = req.body || {};
  const name = body.name !== undefined ? parsePlanName(body.name) : existing.name;
  const imageUrl = body.imageUrl !== undefined ? parseImageUrl(body.imageUrl) : existing.image_url;
  const replaceZones = body.zones !== undefined;
  const replacePlacements = body.placements !== undefined;
  const zones = replaceZones ? parseZones(body.zones, new Set()) : null;
  const placements = replacePlacements ? parsePlacements(body.placements) : null;

  await inTransaction(async (conn) => {
    await conn.query(
      'UPDATE floor_plans SET name = ?, image_url = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?',
      [name, imageUrl, existing.id]
    );
    if (replaceZones || replacePlacements) {
      const current = (await loadPlans(conn, existing.id))[0];
      await writePlanContents(
        conn,
        existing.id,
        zones ?? current.zones,
        placements ?? current.placements
      );
    }
  });

  await audit.log('Settings', 'Modified', `Floor plan "${name}" was updated`, req.auditUser, req.auditUserId);
  ok(res, 'Floor plan updated', await loadPlan(existing.id));
});

plansRouter.delete('/:id', async (req, res) => {
  const existing = await requirePlan(req.params.id);
  const activeId = await inTransaction(async (conn) => {
    await conn.query('DELETE FROM floor_plans WHERE id = ?', [existing.id]);
    const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM floor_plans');
    if (Number(n) === 0) {
      await conn.query(
        `INSERT INTO floor_plans (id, name, image_url, is_active, sort_order, created_at, updated_at)
         VALUES (?, ?, '', 1, 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [DEFAULT_PLAN_ID, DEFAULT_PLAN_NAME]
      );
    }
    await ensureDefaultPlan(conn);
    const [[active]] = await conn.query('SELECT id FROM floor_plans WHERE is_active = 1 LIMIT 1');
    return active.id;
  });
  await unlinkImageIfUnused(existing.image_url);
  await audit.log('Settings', 'Deleted', `Floor plan "${existing.name}" was deleted`, req.auditUser, req.auditUserId);
  ok(res, 'Floor plan deleted', { activeId });
});

const floorImageUpload = uploadImageMiddleware('floor_plan', 'file');

function imageUpload(req, res, next) {
  floorImageUpload(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'File too large. Maximum size is 5MB.' : err.message;
      return fail(res, 400, message || 'Upload failed.', { field: 'file' });
    }
    if (err.message && /^Invalid (file type|MIME type)/.test(err.message)) {
      return fail(res, 400, err.message, { field: 'file' });
    }
    return next(err);
  });
}

plansRouter.post('/:id/image', async (req, res, next) => {
  await requirePlan(req.params.id);
  next();
}, imageUpload, async (req, res) => {
  if (!req.file) throw validationError('An image file is required in the "file" field.', 'file');
  if (!req.file.size) {
    await fs.unlink(req.file.path).catch(() => {});
    throw validationError('The image file is empty.', 'file');
  }
  const existing = await getPlanRow(req.params.id);
  const imageUrl = publicUrlForStoredFile(FLOOR_PLAN_SUBDIR, req.file.filename);
  await db.query('UPDATE floor_plans SET image_url = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?', [
    imageUrl,
    existing.id,
  ]);
  if (existing.image_url && existing.image_url !== imageUrl) await unlinkImageIfUnused(existing.image_url);
  await audit.log('Settings', 'Modified', `Floor plan "${existing.name}" image uploaded`, req.auditUser, req.auditUserId);
  ok(res, 'Floor image uploaded', { id: existing.id, imageUrl });
});

plansRouter.delete('/:id/image', async (req, res) => {
  const existing = await requirePlan(req.params.id);
  await db.query("UPDATE floor_plans SET image_url = '', updated_at = UTC_TIMESTAMP(3) WHERE id = ?", [existing.id]);
  await unlinkImageIfUnused(existing.image_url);
  await audit.log('Settings', 'Modified', `Floor plan "${existing.name}" image removed`, req.auditUser, req.auditUserId);
  ok(res, 'Floor image removed', { id: existing.id, imageUrl: '' });
});

plansRouter.use(envelopeNotFound);
plansRouter.use(envelopeErrorHandler);

module.exports = { layoutRouter, plansRouter };
