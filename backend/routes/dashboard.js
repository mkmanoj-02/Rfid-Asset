const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
  const [[{ total_assets }]] = await db.query('SELECT COUNT(*) AS total_assets FROM assets');
  const [[{ total_locations }]] = await db.query('SELECT COUNT(*) AS total_locations FROM locations');
  const [[{ total_types }]] = await db.query('SELECT COUNT(*) AS total_types FROM asset_types');

  const [assetsByType] = await db.query(`
    SELECT at.name AS type, COUNT(a.id) AS count
    FROM asset_types at
    LEFT JOIN assets a ON a.asset_type_id = at.id
    GROUP BY at.id
  `);

  const [assetsByLocation] = await db.query(`
    SELECT l.name AS location, COUNT(a.id) AS count
    FROM locations l
    LEFT JOIN assets a ON a.current_location_id = l.id
    GROUP BY l.id
  `);

  const [recentMovements] = await db.query(`
    SELECT mh.moved_at, a.name AS asset_name, a.rfid_tag,
      fl.name AS from_location, tl.name AS to_location
    FROM movement_history mh
    JOIN assets a ON mh.asset_id = a.id
    LEFT JOIN locations fl ON mh.from_location_id = fl.id
    JOIN locations tl ON mh.to_location_id = tl.id
    ORDER BY mh.moved_at DESC
    LIMIT 3
  `);

  const [statusBreakdown] = await db.query(`
    SELECT status, COUNT(*) AS count FROM assets GROUP BY status
  `);

  res.json({
    total_assets,
    total_locations,
    total_types,
    assets_by_type: assetsByType,
    assets_by_location: assetsByLocation,
    recent_movements: recentMovements,
    status_breakdown: statusBreakdown,
  });
});

// Location detail for dashboard popup
router.get('/location/:id', async (req, res) => {
  const id = req.params.id;
  const [[loc]] = await db.query('SELECT * FROM locations WHERE id=?', [id]);
  if (!loc) return res.status(404).json({ message: 'Not found' });

  // Total assets at this location
  const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM assets WHERE current_location_id=?', [id]);
  // Missing (inactive)
  const [[{ missing }]] = await db.query("SELECT COUNT(*) AS missing FROM assets WHERE current_location_id=? AND status='inactive'", [id]);
  // Sub-locations with counts
  const [subLocs] = await db.query(`
    SELECT l.name, COUNT(a.id) AS count
    FROM locations l LEFT JOIN assets a ON a.current_location_id = l.id
    WHERE l.parent_id=? GROUP BY l.id`, [id]);
  // By asset type
  const [byType] = await db.query(`
    SELECT at.name, COUNT(a.id) AS count
    FROM assets a JOIN asset_types at ON a.asset_type_id=at.id
    WHERE a.current_location_id=? GROUP BY at.id ORDER BY count DESC LIMIT 5`, [id]);
  // Recent transactions
  const [recentTx] = await db.query(`
    SELECT mh.moved_at, a.name AS asset_name, a.asset_serial,
      fl.name AS from_loc, tl.name AS to_loc
    FROM movement_history mh
    JOIN assets a ON mh.asset_id=a.id
    LEFT JOIN locations fl ON mh.from_location_id=fl.id
    JOIN locations tl ON mh.to_location_id=tl.id
    WHERE mh.to_location_id=? OR mh.from_location_id=?
    ORDER BY mh.moved_at DESC LIMIT 3`, [id, id]);
  // Recent alerts for this location
  const [recentAlerts] = await db.query(`
    SELECT * FROM alerts WHERE last_known_location=? ORDER BY alert_time DESC LIMIT 3`, [loc.name]);

  res.json({ loc, total, missing, subLocs, byType, recentTx, recentAlerts });
});

module.exports = router;
