const express = require('express');
const router = express.Router();
const db = require('../db');
const audit = require('../audit');

// Get all rules
router.get('/', async (req, res) => {
  const [rows] = await db.query(`
    SELECT r.*, l.name AS location_name, at.name AS asset_type_name,
      ata.name AS attribute_name
    FROM rules r
    LEFT JOIN locations l ON r.location_id = l.id
    LEFT JOIN asset_types at ON r.asset_type_id = at.id
    LEFT JOIN asset_type_attributes ata ON r.attribute_id = ata.id
    ORDER BY r.created_at DESC
  `);
  res.json(rows);
});

// Get single rule
router.get('/:id', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM rules WHERE id = ?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ message: 'Not found' });
  res.json(rows[0]);
});

// Create rule
router.post('/', async (req, res) => {
  const {
    name, description, filter_type,
    location_id, include_sub_locations, asset_type_id,
    asset_action, duration_value, duration_unit, duration_condition,
    inventory_condition, inventory_value,
    attribute_id, attribute_condition, attribute_value,
    maintenance_alert_value, maintenance_alert_unit, maintenance_condition,
    action_type, action_email,
  } = req.body;

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
});

// Update rule
router.put('/:id', async (req, res) => {
  const {
    name, description, filter_type,
    location_id, include_sub_locations, asset_type_id,
    asset_action, duration_value, duration_unit, duration_condition,
    inventory_condition, inventory_value,
    attribute_id, attribute_condition, attribute_value,
    maintenance_alert_value, maintenance_alert_unit, maintenance_condition,
    action_type, action_email, is_active,
  } = req.body;

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
});

// Bulk Delete rules
router.delete('/bulk', async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length)
      return res.status(400).json({ message: 'ids array is required' });

    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await db.query(`SELECT name FROM rules WHERE id IN (${placeholders})`, ids);
    await db.query(`DELETE FROM rules WHERE id IN (${placeholders})`, ids);

    for (const row of rows)
      await audit.log('Rule', 'Deleted', `Rule "${row.name}" was deleted`, req.auditUser, req.auditUserId);

    res.json({ message: `${rows.length} rule(s) deleted` });
  } catch (err) { next(err); }
});

// Delete rule
router.delete('/:id', async (req, res) => {
  const [rows] = await db.query('SELECT name FROM rules WHERE id=?', [req.params.id]);
  await db.query('DELETE FROM rules WHERE id = ?', [req.params.id]);
  if (rows.length) await audit.log('Rule', 'Deleted', `Rule "${rows[0].name}" was deleted`, req.auditUser, req.auditUserId);
  res.json({ message: 'Deleted' });
});

module.exports = router;
