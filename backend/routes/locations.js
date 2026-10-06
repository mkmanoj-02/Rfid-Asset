const express = require('express');
const router = express.Router();
const db = require('../db');
const audit = require('../audit');
const resourceImages = require('../controllers/resourceImages');
const { uploadImageMiddleware, handleMulterImageError } = require('../helper/upload');
const { optionalImageUpload } = require('../middleware/optionalImageUpload');
const {
  imageUrlFromUpload,
  resolveLocationImageOnUpdate,
  cleanupLocationImageOnDelete,
  truthyFormFlag,
} = require('../controllers/locationImages');
const { assertLocationAccess } = require('../lib/userAuthz');
const { requireModify, requireDelete } = require('../middleware/requireAuthz');
const {
  normalizeName,
  nameKey,
  stripParentPrefix,
  planLocationName,
  loadLocationRows,
  loadParent,
  withLocationNameLock,
} = require('../services/locationNameService');

function allowedLocationIds(req) {
  return req.authz?.locationIds ?? null;
}

// Get all locations as a flat list with parent info
router.get('/', async (req, res) => {
  const allowedIds = allowedLocationIds(req);

  let query = `SELECT l.*, p.name AS parent_name, lt.name AS location_type_name
    FROM locations l
    LEFT JOIN locations p ON l.parent_id = p.id
    LEFT JOIN location_types lt ON l.location_type_id = lt.id`;
  const params = [];
  if (allowedIds) {
    query += ` WHERE l.id IN (${allowedIds.map(() => '?').join(',')})`;
    params.push(...allowedIds);
  }
  query += ' ORDER BY l.parent_id, l.name';
  const [rows] = await db.query(query, params);
  res.json(rows);
});

// Get tree structure
router.get('/tree', async (req, res) => {
  const allowedIds = allowedLocationIds(req);

  let query = 'SELECT * FROM locations';
  const params = [];
  if (allowedIds) {
    query += ` WHERE id IN (${allowedIds.map(() => '?').join(',')})`;
    params.push(...allowedIds);
  }
  query += ' ORDER BY parent_id, name';
  const [rows] = await db.query(query, params);
  const buildTree = (items, parentId = null) =>
    items.filter(i => (i.parent_id || null) == parentId).map(i => ({ ...i, children: buildTree(items, i.id) }));
  res.json(buildTree(rows));
});

router.post(
  '/:id/image',
  requireModify('location'),
  uploadImageMiddleware('locations'),
  handleMulterImageError,
  resourceImages.upload('locations')
);
router.delete('/:id/image', requireModify('location'), resourceImages.remove('locations'));

router.get('/:id', async (req, res) => {
  const locErr = assertLocationAccess(req.authz, res, req.params.id);
  if (locErr) return locErr;

  const [rows] = await db.query(`
    SELECT l.*, p.name AS parent_name 
    FROM locations l LEFT JOIN locations p ON l.parent_id = p.id
    WHERE l.id = ?`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ message: 'Not found' });
  res.json(rows[0]);
});

async function discardUpload(req) {
  if (req.file?.path) {
    try { await require('fs').promises.unlink(req.file.path); } catch {}
  }
}

function parseParentId(value) {
  return value === undefined || value === null || value === '' ? null : value;
}

/** 409 asking the client to confirm saving under the generated "parent_child" name. */
function nameConfirmResponse(res, plan) {
  return res.status(409).json({
    code: 'LOCATION_NAME_CONFIRM',
    message: `The name "${plan.originalName}" already exists. We can save it as "${plan.name}".`,
    original_name: plan.originalName,
    suggested_name: plan.name,
  });
}

router.post('/', requireModify('location'), optionalImageUpload('locations'), async (req, res, next) => {
  try {
    const { description } = req.body;
    const pid = parseParentId(req.body.parent_id);
    if (!normalizeName(req.body.name)) {
      await discardUpload(req);
      return res.status(400).json({ message: 'Location name is required' });
    }
    const confirmed = truthyFormFlag(req.body.confirm_generated_name);

    const outcome = await withLocationNameLock(db, async (conn) => {
      const parent = await loadParent(conn, pid);
      if (pid != null && !parent) return { status: 400, body: { message: 'Parent location not found' } };

      const plan = planLocationName(await loadLocationRows(conn), { name: req.body.name, parent });
      if (plan.error) return { status: plan.status, body: { message: plan.error } };
      if (plan.generated && !confirmed) return { confirm: plan };

      const imageUrl = imageUrlFromUpload(req.file);
      const [result] = await conn.query(
        'INSERT INTO locations (name, description, parent_id, location_type_id, image_url) VALUES (?, ?, ?, ?, ?)',
        [plan.name, description || null, pid, req.body.location_type_id || null, imageUrl]
      );
      return { plan, imageUrl, id: result.insertId };
    });

    if (outcome.confirm) {
      await discardUpload(req);
      return nameConfirmResponse(res, outcome.confirm);
    }
    if (outcome.status) {
      await discardUpload(req);
      return res.status(outcome.status).json(outcome.body);
    }

    req.file = null;
    await audit.log('Location', 'Added', `Location "${outcome.plan.name}" was created`, req.auditUser, req.auditUserId);
    res.status(201).json({
      id: outcome.id,
      name: outcome.plan.name,
      description,
      parent_id: pid,
      image_url: outcome.imageUrl,
    });
  } catch (err) {
    await discardUpload(req);
    next(err);
  }
});

router.put('/:id', requireModify('location'), optionalImageUpload('locations'), async (req, res, next) => {
  try {
    const locErr = assertLocationAccess(req.authz, res, req.params.id);
    if (locErr) {
      await discardUpload(req);
      return locErr;
    }

    const { description } = req.body;
    const pid = parseParentId(req.body.parent_id);
    if (!normalizeName(req.body.name)) {
      await discardUpload(req);
      return res.status(400).json({ message: 'Location name is required' });
    }
    const confirmed = truthyFormFlag(req.body.confirm_generated_name);

    const outcome = await withLocationNameLock(db, async (conn) => {
      const [[current]] = await conn.query(
        'SELECT id, name, parent_id, image_url FROM locations WHERE id = ?',
        [req.params.id]
      );
      if (!current) return { status: 404, body: { message: 'Not found' } };

      const parent = await loadParent(conn, pid);
      if (pid != null && !parent) return { status: 400, body: { message: 'Parent location not found' } };
      if (parent && Number(parent.id) === Number(current.id)) {
        return { status: 400, body: { message: 'A location cannot be its own parent' } };
      }

      let requestedName = req.body.name;
      if (current.parent_id != null && Number(current.parent_id) !== Number(pid)) {
        const oldParent = await loadParent(conn, current.parent_id);
        requestedName = stripParentPrefix(requestedName, oldParent?.name);
      }

      const plan = planLocationName(await loadLocationRows(conn), {
        name: requestedName,
        parent,
        excludeId: current.id,
      });
      if (plan.error) return { status: plan.status, body: { message: plan.error } };
      const unchangedName = nameKey(plan.name) === nameKey(current.name);
      if (plan.generated && !unchangedName && !confirmed) return { confirm: plan };

      const imageUrl = await resolveLocationImageOnUpdate(
        current.image_url,
        req.file,
        truthyFormFlag(req.body.remove_image)
      );
      await conn.query(
        'UPDATE locations SET name = ?, description = ?, parent_id = ?, location_type_id = ?, image_url = ? WHERE id = ?',
        [plan.name, description || null, pid, req.body.location_type_id || null, imageUrl, current.id]
      );
      return { plan, imageUrl };
    });

    if (outcome.confirm) {
      await discardUpload(req);
      return nameConfirmResponse(res, outcome.confirm);
    }
    if (outcome.status) {
      await discardUpload(req);
      return res.status(outcome.status).json(outcome.body);
    }

    req.file = null;
    await audit.log('Location', 'Modified', `Location "${outcome.plan.name}" was updated`, req.auditUser, req.auditUserId);
    res.json({ message: 'Updated', name: outcome.plan.name, image_url: outcome.imageUrl });
  } catch (err) {
    await discardUpload(req);
    next(err);
  }
});

router.delete('/bulk', requireDelete('location'), async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length)
      return res.status(400).json({ message: 'ids array is required' });

    for (const rawId of ids) {
      const locErr = assertLocationAccess(req.authz, res, rawId);
      if (locErr) return locErr;
    }

    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await db.query(
      `SELECT id, name, image_url FROM locations WHERE id IN (${placeholders})`,
      ids
    );
    for (const row of rows) await cleanupLocationImageOnDelete(row);
    await db.query(`DELETE FROM locations WHERE id IN (${placeholders})`, ids);
    for (const row of rows)
      await audit.log('Location', 'Deleted', `Location "${row.name}" was deleted`, req.auditUser, req.auditUserId);
    res.json({ message: `${rows.length} location(s) deleted` });
  } catch (e) { next(e); }
});

router.delete('/:id', requireDelete('location'), async (req, res, next) => {
  try {
    const locErr = assertLocationAccess(req.authz, res, req.params.id);
    if (locErr) return locErr;

    const [rows] = await db.query('SELECT name, image_url FROM locations WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Not found' });
    await cleanupLocationImageOnDelete(rows[0]);
    await db.query('DELETE FROM locations WHERE id = ?', [req.params.id]);
    await audit.log('Location', 'Deleted', `Location "${rows[0].name}" was deleted`, req.auditUser, req.auditUserId);
    res.json({ message: 'Deleted' });
  } catch (e) { next(e); }
});

module.exports = router;
