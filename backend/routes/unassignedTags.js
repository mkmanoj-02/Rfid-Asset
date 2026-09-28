const express = require('express');
const router  = express.Router();
const db      = require('../db');
const audit   = require('../audit');
const { assertAssetInScope } = require('../lib/userAuthz');
const { requireModify } = require('../middleware/requireAuthz');
const { shouldLogRfidTagMovement, insertRfidTagMovement } = require('../lib/rfidMovements');
const { withTransaction } = require('../lib/importHelpers');

const SELECT_SQL = `
  SELECT ut.id, ut.tag_value, ut.source, ut.reader_id, ut.zone_id, z.name AS zone_name,
         ut.notes, ut.created_at
  FROM unassigned_tags ut
  LEFT JOIN zones z ON z.id = ut.zone_id`;

function parseId(param) {
  const id = parseInt(param, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// GET all unassigned tags (optional search, zone_id)
router.get('/', async (req, res, next) => {
  try {
    const search = (req.query.search || '').trim();
    const conditions = [];
    const params = [];

    if (search) {
      conditions.push(
        '(ut.tag_value LIKE ? OR IFNULL(ut.source, "") LIKE ? OR IFNULL(ut.reader_id, "") LIKE ? ' +
        'OR IFNULL(ut.notes, "") LIKE ? OR IFNULL(z.name, "") LIKE ?)'
      );
      const like = `%${search}%`;
      params.push(like, like, like, like, like);
    }

    if (req.query.zone_id !== undefined && req.query.zone_id !== '') {
      const zoneId = parseId(req.query.zone_id);
      if (zoneId == null) return res.status(400).json({ message: 'Invalid zone_id' });
      conditions.push('ut.zone_id = ?');
      params.push(zoneId);
    }

    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const orderBy = ' ORDER BY ut.created_at DESC, ut.id DESC';

    // Without page+limit, return a plain array (used by the asset form RFID picker)
    if (req.query.page === undefined || req.query.limit === undefined) {
      const [rows] = await db.query(`${SELECT_SQL}${where}${orderBy}`, params);
      return res.json(rows);
    }

    const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 25));

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM unassigned_tags ut LEFT JOIN zones z ON z.id = ut.zone_id${where}`,
      params
    );
    const [rows] = await db.query(
      `${SELECT_SQL}${where}${orderBy} LIMIT ? OFFSET ?`,
      [...params, pageSize, (pageNum - 1) * pageSize]
    );
    res.json({
      data: rows,
      pagination: { total: total || 0, page: pageNum, limit: pageSize },
    });
  } catch (err) {
    next(err);
  }
});

// GET single
router.get('/:id', async (req, res, next) => {
  try {
    const [rows] = await db.query(`${SELECT_SQL} WHERE ut.id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST assign tag to an asset that has no RFID tag
router.post('/:id/assign', requireModify('asset'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (id == null) return res.status(404).json({ message: 'Tag not found' });

    const assetId = parseId(req.body?.asset_id);
    if (assetId == null) return res.status(400).json({ message: 'asset_id is required' });

    const scopeErr = await assertAssetInScope(req.authz, res, assetId);
    if (scopeErr) return scopeErr;

    const result = await withTransaction(db, async (conn) => {
      const [tags] = await conn.query(
        'SELECT id, tag_value FROM unassigned_tags WHERE id = ? FOR UPDATE',
        [id]
      );
      if (!tags.length) return { status: 404, message: 'Tag not found' };
      const tagValue = String(tags[0].tag_value).trim();

      const [assets] = await conn.query(
        'SELECT id, name, rfid_tag, current_location_id FROM assets WHERE id = ? FOR UPDATE',
        [assetId]
      );
      if (!assets.length) return { status: 404, message: 'Asset not found' };
      const asset = assets[0];
      if (asset.rfid_tag && String(asset.rfid_tag).trim()) {
        return { status: 409, message: `Asset "${asset.name}" already has an RFID tag` };
      }

      const [dup] = await conn.query(
        'SELECT id, name FROM assets WHERE rfid_tag = ? AND id != ? LIMIT 1',
        [tagValue, assetId]
      );
      if (dup.length) {
        return { status: 409, message: `Tag is already assigned to asset "${dup[0].name}"` };
      }

      await conn.query(
        'UPDATE assets SET rfid_tag = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [tagValue, assetId]
      );
      if (shouldLogRfidTagMovement(asset.rfid_tag, tagValue)) {
        await insertRfidTagMovement(conn, assetId, asset.current_location_id);
      }
      await conn.query('DELETE FROM unassigned_tags WHERE id = ?', [id]);

      return { asset, tagValue };
    });

    if (result.status) return res.status(result.status).json({ message: result.message });

    await audit.log(
      'Asset',
      'Modified',
      `Tag "${result.tagValue}" was assigned to asset "${result.asset.name}"`,
      req.auditUser,
      req.auditUserId
    );
    res.json({ message: 'Assigned', asset_id: assetId, rfid_tag: result.tagValue });
  } catch (err) {
    next(err);
  }
});

// DELETE one
router.delete('/:id', async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT tag_value FROM unassigned_tags WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Not found' });

    await db.query('DELETE FROM unassigned_tags WHERE id = ?', [req.params.id]);
    await audit.log(
      'Asset',
      'Deleted',
      `Unassigned tag "${rows[0].tag_value}" was deleted`,
      req.auditUser,
      req.auditUserId
    );
    res.json({ message: 'Deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
