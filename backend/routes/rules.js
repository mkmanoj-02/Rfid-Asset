const express = require('express');
const router = express.Router();
const db = require('../db');
const audit = require('../audit');
const {
  buildRuleScopeWhere,
  assertRuleInScope,
  assertRulePayload,
} = require('../lib/userAuthz');

// List rules — paginate only when both page and limit are provided (same as assets)
router.get('/', async (req, res, next) => {
  try {
    const { page, limit, search } = req.query;
    const paginate = page !== undefined && limit !== undefined;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(500, Math.max(1, parseInt(limit, 10) || 1));
    const offset = (pageNum - 1) * pageSize;

    const scope = await buildRuleScopeWhere(req.authz, 'r');

    let searchClause = '';
    const searchParams = [];
    const searchTerm = search != null ? String(search).trim() : '';
    if (searchTerm) {
      const s = `%${searchTerm}%`;
      searchClause = ` AND (
        r.name LIKE ? OR
        r.description LIKE ? OR
        CAST(r.filter_type AS CHAR) LIKE ? OR
        l.name LIKE ? OR
        at.name LIKE ? OR
        ata.name LIKE ? OR
        COALESCE(r.action_email, '') LIKE ? OR
        CAST(COALESCE(r.asset_action, '') AS CHAR) LIKE ?
      )`;
      searchParams.push(s, s, s, s, s, s, s, s);
    }

    const baseFrom = `
      FROM rules r
      LEFT JOIN locations l ON r.location_id = l.id
      LEFT JOIN asset_types at ON r.asset_type_id = at.id
      LEFT JOIN asset_type_attributes ata ON r.attribute_id = ata.id
      WHERE 1=1${scope.clause}${searchClause}`;

    const selectQuery = `
      SELECT r.*, l.name AS location_name, at.name AS asset_type_name,
        ata.name AS attribute_name
      ${baseFrom}
      ORDER BY r.created_at DESC, r.id DESC`;

    const baseParams = [...scope.params, ...searchParams];

    if (paginate) {
      const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total ${baseFrom}`, baseParams);
      const [rows] = await db.query(`${selectQuery} LIMIT ? OFFSET ?`, [
        ...baseParams,
        pageSize,
        offset,
      ]);
      return res.json({
        data: rows,
        pagination: {
          total,
          page: pageNum,
          limit: pageSize,
          totalPages: Math.ceil(total / pageSize) || 0,
        },
      });
    }

    const [rows] = await db.query(selectQuery, baseParams);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Get single rule
router.get('/:id', async (req, res, next) => {
  try {
    const scopeErr = await assertRuleInScope(req.authz, res, req.params.id);
    if (scopeErr) return scopeErr;

    const [rows] = await db.query('SELECT * FROM rules WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// Create rule
router.post('/', async (req, res, next) => {
  try {
    const {
      name, description, filter_type,
      location_id, include_sub_locations, asset_type_id,
      asset_action, duration_value, duration_unit, duration_condition,
      inventory_condition, inventory_value,
      attribute_id, attribute_condition, attribute_value,
      maintenance_alert_value, maintenance_alert_unit, maintenance_condition,
      action_type, action_email,
    } = req.body;

    const payloadErr = assertRulePayload(req.authz, res, { location_id, asset_type_id });
    if (payloadErr) return payloadErr;

    const [result] = await db.query(
      `INSERT INTO rules (name, description, filter_type,
        location_id, include_sub_locations, asset_type_id,
        asset_action, duration_value, duration_unit, duration_condition,
        inventory_condition, inventory_value,
        attribute_id, attribute_condition, attribute_value,
        maintenance_alert_value, maintenance_alert_unit, maintenance_condition,
        action_type, action_email)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        name, description || null, filter_type,
        location_id || null, include_sub_locations ? 1 : 0, asset_type_id || null,
        asset_action || null, duration_value || null, duration_unit || null, duration_condition || null,
        inventory_condition || null, inventory_value || null,
        attribute_id || null, attribute_condition || null, attribute_value || null,
        maintenance_alert_value || null, maintenance_alert_unit || null, maintenance_condition || null,
        action_type || 'system_alert', action_email || null,
      ]
    );
    await audit.log('Rule', 'Added', `Rule "${name}" (${filter_type}) was created`, req.auditUser, req.auditUserId);
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    next(err);
  }
});

// Update rule
router.put('/:id', async (req, res, next) => {
  try {
    const scopeErr = await assertRuleInScope(req.authz, res, req.params.id);
    if (scopeErr) return scopeErr;

    const {
      name, description, filter_type,
      location_id, include_sub_locations, asset_type_id,
      asset_action, duration_value, duration_unit, duration_condition,
      inventory_condition, inventory_value,
      attribute_id, attribute_condition, attribute_value,
      maintenance_alert_value, maintenance_alert_unit, maintenance_condition,
      action_type, action_email, is_active,
    } = req.body;

    const payloadErr = assertRulePayload(req.authz, res, { location_id, asset_type_id });
    if (payloadErr) return payloadErr;

    await db.query(
      `UPDATE rules SET name=?, description=?, filter_type=?,
        location_id=?, include_sub_locations=?, asset_type_id=?,
        asset_action=?, duration_value=?, duration_unit=?, duration_condition=?,
        inventory_condition=?, inventory_value=?,
        attribute_id=?, attribute_condition=?, attribute_value=?,
        maintenance_alert_value=?, maintenance_alert_unit=?, maintenance_condition=?,
        action_type=?, action_email=?, is_active=?
       WHERE id=?`,
      [
        name, description || null, filter_type,
        location_id || null, include_sub_locations ? 1 : 0, asset_type_id || null,
        asset_action || null, duration_value || null, duration_unit || null, duration_condition || null,
        inventory_condition || null, inventory_value || null,
        attribute_id || null, attribute_condition || null, attribute_value || null,
        maintenance_alert_value || null, maintenance_alert_unit || null, maintenance_condition || null,
        action_type || 'system_alert', action_email || null, is_active ? 1 : 0,
        req.params.id,
      ]
    );
    await audit.log('Rule', 'Modified', `Rule "${name}" was updated`, req.auditUser, req.auditUserId);
    res.json({ message: 'Updated' });
  } catch (err) {
    next(err);
  }
});

// Bulk Delete rules
router.delete('/bulk', async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ message: 'ids array is required' });
    }

    for (const rawId of ids) {
      const err = await assertRuleInScope(req.authz, res, rawId);
      if (err) return err;
    }

    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await db.query(`SELECT name FROM rules WHERE id IN (${placeholders})`, ids);
    await db.query(`DELETE FROM rules WHERE id IN (${placeholders})`, ids);

    for (const row of rows) {
      await audit.log('Rule', 'Deleted', `Rule "${row.name}" was deleted`, req.auditUser, req.auditUserId);
    }

    res.json({ message: `${rows.length} rule(s) deleted` });
  } catch (err) {
    next(err);
  }
});

// Delete rule
router.delete('/:id', async (req, res, next) => {
  try {
    const scopeErr = await assertRuleInScope(req.authz, res, req.params.id);
    if (scopeErr) return scopeErr;

    const [rows] = await db.query('SELECT name FROM rules WHERE id=?', [req.params.id]);
    await db.query('DELETE FROM rules WHERE id = ?', [req.params.id]);
    if (rows.length) {
      await audit.log('Rule', 'Deleted', `Rule "${rows[0].name}" was deleted`, req.auditUser, req.auditUserId);
    }
    res.json({ message: 'Deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
