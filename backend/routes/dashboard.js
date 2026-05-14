const express = require('express');
const router = express.Router();
const db = require('../db');

// Include the location and all descendant locations (same behavior as assets / locations routes).
async function expandWithSubLocations(ids) {
  if (!ids || !ids.length) return ids;
  const [all] = await db.query('SELECT id, parent_id FROM locations');
  const result = new Set(ids.map(Number));
  const addChildren = (pid) => {
    all.filter((l) => l.parent_id === pid).forEach((l) => {
      if (!result.has(l.id)) {
        result.add(l.id);
        addChildren(l.id);
      }
    });
  };
  ids.forEach((id) => addChildren(Number(id)));
  return [...result];
}

router.get('/', async (req, res) => {
  const locParam = req.query.location;
  let locationIds = null;
  let locationMeta = null;

  if (locParam !== undefined && locParam !== '') {
    const rootId = parseInt(locParam, 10);
    if (Number.isNaN(rootId)) {
      return res.status(400).json({ message: 'Invalid location' });
    }
    const [[loc]] = await db.query('SELECT id, name FROM locations WHERE id=?', [rootId]);
    if (!loc) {
      return res.status(404).json({ message: 'Location not found' });
    }
    locationIds = await expandWithSubLocations([rootId]);
    locationMeta = {
      id: loc.id,
      name: loc.name,
      subtree_location_count: locationIds.length,
    };
  }

  const ph = locationIds && locationIds.length ? locationIds.map(() => '?').join(',') : null;
  const locParams = locationIds && locationIds.length ? locationIds : [];

  let total_assets;
  let total_locations;
  let total_types;
  let assetsByType;
  let assetsByLocation;
  let recentMovements;
  let tagged;
  let untagged;

  if (ph) {
    const [[ta]] = await db.query(
      `SELECT COUNT(*) AS total_assets FROM assets WHERE current_location_id IN (${ph})`,
      locParams
    );
    total_assets = ta.total_assets;

    const [[tl]] = await db.query('SELECT COUNT(*) AS total_locations FROM locations');
    total_locations = tl.total_locations;
    const [[tt]] = await db.query('SELECT COUNT(*) AS total_types FROM asset_types');
    total_types = tt.total_types;

    [assetsByType] = await db.query(
      `SELECT at.name AS type, COUNT(a.id) AS count
      FROM asset_types at
      LEFT JOIN assets a ON a.asset_type_id = at.id AND a.current_location_id IN (${ph})
      GROUP BY at.id`,
      locParams
    );

    [assetsByLocation] = await db.query(
      `SELECT l.name AS location, COUNT(a.id) AS count
      FROM locations l
      LEFT JOIN assets a ON a.current_location_id = l.id
      WHERE l.id IN (${ph})
      GROUP BY l.id`,
      locParams
    );

    [recentMovements] = await db.query(
      `SELECT mh.moved_at, a.name AS asset_name, a.rfid_tag,
        fl.name AS from_location, tl.name AS to_location
      FROM movement_history mh
      JOIN assets a ON mh.asset_id = a.id
      LEFT JOIN locations fl ON mh.from_location_id = fl.id
      JOIN locations tl ON mh.to_location_id = tl.id
      WHERE mh.to_location_id IN (${ph}) OR mh.from_location_id IN (${ph})
      ORDER BY mh.moved_at DESC
      LIMIT 3`,
      [...locParams, ...locParams]
    );

    const [[tg]] = await db.query(
      `SELECT COUNT(*) AS tagged FROM assets WHERE current_location_id IN (${ph})
      AND rfid_tag IS NOT NULL AND rfid_tag != ''`,
      locParams
    );
    tagged = tg.tagged;
    const [[ut]] = await db.query(
      `SELECT COUNT(*) AS untagged FROM assets WHERE current_location_id IN (${ph})
      AND (rfid_tag IS NULL OR rfid_tag = '')`,
      locParams
    );
    untagged = ut.untagged;
  } else {
    const [[{ total_assets: ta }]] = await db.query('SELECT COUNT(*) AS total_assets FROM assets');
    total_assets = ta;
    const [[{ total_locations: tl }]] = await db.query('SELECT COUNT(*) AS total_locations FROM locations');
    total_locations = tl;
    const [[{ total_types: tt }]] = await db.query('SELECT COUNT(*) AS total_types FROM asset_types');
    total_types = tt;

    [assetsByType] = await db.query(`
      SELECT at.name AS type, COUNT(a.id) AS count
      FROM asset_types at
      LEFT JOIN assets a ON a.asset_type_id = at.id
      GROUP BY at.id
    `);

    [assetsByLocation] = await db.query(`
      SELECT l.name AS location, COUNT(a.id) AS count
      FROM locations l
      LEFT JOIN assets a ON a.current_location_id = l.id
      GROUP BY l.id
    `);

    [recentMovements] = await db.query(`
      SELECT mh.moved_at, a.name AS asset_name, a.rfid_tag,
        fl.name AS from_location, tl.name AS to_location
      FROM movement_history mh
      JOIN assets a ON mh.asset_id = a.id
      LEFT JOIN locations fl ON mh.from_location_id = fl.id
      JOIN locations tl ON mh.to_location_id = tl.id
      ORDER BY mh.moved_at DESC
      LIMIT 3
    `);

    const [[{ tagged: tg }]] = await db.query(
      "SELECT COUNT(*) AS tagged FROM assets WHERE rfid_tag IS NOT NULL AND rfid_tag != ''"
    );
    tagged = tg;
    const [[{ untagged: ut }]] = await db.query(
      "SELECT COUNT(*) AS untagged FROM assets WHERE rfid_tag IS NULL OR rfid_tag = ''"
    );
    untagged = ut;
  }

  const body = {
    total_assets,
    total_locations,
    total_types,
    assets_by_type: assetsByType,
    assets_by_location: assetsByLocation,
    recent_movements: recentMovements,
    rfid_breakdown: { tagged, untagged },
  };
  if (locationMeta) {
    body.location = locationMeta;
  }
  res.json(body);
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
