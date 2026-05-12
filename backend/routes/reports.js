const express = require('express');
const router = express.Router();
const db = require('../db');

// ── Dashboard Report data ──────────────────────────────────────

// Inventory vs Missing (assets with last_seen > 30 days = missing)
router.get('/inventory-missing', async (req, res) => {
  const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM assets');
  const [[{ missing }]] = await db.query(`
    SELECT COUNT(*) AS missing FROM assets
    WHERE id NOT IN (
      SELECT DISTINCT asset_id FROM movement_history
      WHERE moved_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
    )
  `);
  const inventory = total - missing;
  res.json({ inventory, missing, total });
});

// Most transacted assets (most location changes)
router.get('/most-transacted', async (req, res) => {
  const [rows] = await db.query(`
    SELECT a.name AS asset_name, a.asset_serial,
      SUM(CASE WHEN mh.from_location_id IS NOT NULL THEN 1 ELSE 0 END) AS out_count,
      COUNT(mh.id) AS in_count
    FROM movement_history mh
    JOIN assets a ON mh.asset_id = a.id
    GROUP BY a.id
    ORDER BY in_count DESC
    LIMIT 10
  `);
  res.json(rows);
});

// Top unscanned locations (locations where assets haven't moved recently)
router.get('/unscanned-locations', async (req, res) => {
  const [rows] = await db.query(`
    SELECT l.name AS location,
      MIN(mh.moved_at) AS last_scan,
      TIMESTAMPDIFF(DAY, MIN(mh.moved_at), NOW()) AS days_since
    FROM locations l
    JOIN assets a ON a.current_location_id = l.id
    JOIN movement_history mh ON mh.asset_id = a.id
    GROUP BY l.id
    ORDER BY days_since DESC
    LIMIT 10
  `);
  res.json(rows);
});

// Assets by type (for pie chart)
router.get('/assets-by-type', async (req, res) => {
  const [rows] = await db.query(`
    SELECT at.name AS type, COUNT(a.id) AS count
    FROM asset_types at
    LEFT JOIN assets a ON a.asset_type_id = at.id
    GROUP BY at.id
    ORDER BY count DESC
  `);
  res.json(rows);
});

// Assets by location
router.get('/assets-by-location', async (req, res) => {
  const [rows] = await db.query(`
    SELECT l.name AS location, COUNT(a.id) AS count
    FROM locations l
    LEFT JOIN assets a ON a.current_location_id = l.id
    GROUP BY l.id
    ORDER BY count DESC
    LIMIT 10
  `);
  res.json(rows);
});

// ── Tagging Progress Report ────────────────────────────────────
function formatDate(value) {
  if (!value) return value;
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return String(value).split('T')[0];
}
// Assets added per day in date range
router.get('/tagging-progress', async (req, res) => {
  const { from, to } = req.query;
  const fromDate = from || new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];
  const toDate = to || new Date().toISOString().split('T')[0];

  const [rows] = await db.query(`
    SELECT DATE(moved_at) AS date, COUNT(DISTINCT asset_id) AS count
    FROM movement_history
    WHERE notes IN ('Initial placement', 'Imported')
      AND moved_at BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)
    GROUP BY DATE(moved_at)
    ORDER BY date ASC
  `, [fromDate, toDate]);

  // Build cumulative
  let cumulative = 0;
  const result = rows.map(r => {
    cumulative += r.count;
    return { date: formatDate(r.date), count: r.count, cumulative };
  });

  res.json(result);
});

// Movement trend — last 14 days
router.get('/movement-trend', async (req, res) => {
  const [rows] = await db.query(`
    SELECT DATE(moved_at) AS date, COUNT(*) AS count
    FROM movement_history
    WHERE moved_at >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
    GROUP BY DATE(moved_at)
    ORDER BY date ASC
  `);
  res.json(rows);
});

// Status breakdown
router.get('/status-breakdown', async (req, res) => {
  const [rows] = await db.query(`SELECT status, COUNT(*) AS count FROM assets GROUP BY status`);
  res.json(rows);
});

// Top locations with missing assets (inactive assets per location)
router.get('/missing-by-location', async (req, res) => {
  const [rows] = await db.query(`
    SELECT l.name AS location, COUNT(a.id) AS missing_count
    FROM assets a
    JOIN locations l ON a.current_location_id = l.id
    WHERE a.status = 'inactive'
    GROUP BY l.id
    ORDER BY missing_count DESC
    LIMIT 10
  `);
  res.json(rows);
});

// Most active users — by login count
router.get('/most-active-users', async (req, res) => {
  const [rows] = await db.query(`
    SELECT u.username, COUNT(l.id) AS login_count
    FROM users u
    LEFT JOIN login_logs l ON l.user_id = u.id
    GROUP BY u.id
    ORDER BY login_count DESC
    LIMIT 10
  `);
  res.json(rows);
});

module.exports = router;
