const express = require('express');
const router = express.Router();
const db = require('../db');
const audit = require('../audit');
const { buildAssetWhereClause } = require('../lib/assetScope');
const { getActorUserId, loadUserAuthz, deny } = require('../lib/userAuthz');
const { optionalImageUpload } = require('../middleware/optionalImageUpload');
const { resolveDashboardImageOnUpdate } = require('../controllers/dashboardImage');
const { truthyFormFlag } = require('../controllers/imageInheritance');

async function fetchUserDashboardImageUrl(userId) {
  if (!userId) return null;
  try {
    const [rows] = await db.query('SELECT dashboard_image_url FROM users WHERE id = ?', [userId]);
    return rows[0]?.dashboard_image_url || null;
  } catch (err) {
    if (err.code === 'ER_BAD_FIELD_ERROR') return null;
    throw err;
  }
}

function combineWhere(parts) {
  const clauses = parts.filter(Boolean);
  return clauses.length ? clauses.join(' AND ') : '1=1';
}

router.get('/', async (req, res) => {
  const userId = getActorUserId(req);
  const userScope = req.authz || (await loadUserAuthz(userId)) || {};

  const locParam = req.query.location;
  const yearRaw = req.query.year;
  const yearParsed = parseInt(yearRaw, 10);
  const filterYear =
    yearRaw !== undefined && yearRaw !== '' && !Number.isNaN(yearParsed) && yearParsed >= 1990 && yearParsed <= 2100
      ? yearParsed
      : null;

  let locationIds = userScope.locationIds;
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
  if (userScope.locationIds && !userScope.locationIds.includes(rootId)) {
      return deny(res, 'You do not have access to this location');
    }
    locationIds = [rootId];
    locationMeta = {
      id: loc.id,
      name: loc.name,
      subtree_location_count: 1,
    };
  }

  const assetScope = {
    locationIds,
    typeIds: userScope.typeIds,
    attrFilters: userScope.attrFilters,
  };

  const assetWhere = buildAssetWhereClause(assetScope);
  const assetWhereNoLocation = buildAssetWhereClause({
    ...assetScope,
    skip: new Set(['location']),
  });

  const yearSql = filterYear != null ? 'YEAR(a.created_at) = ?' : 'YEAR(a.created_at) = YEAR(CURDATE())';
  const yearParams = filterYear != null ? [filterYear] : [];

  const locPh = locationIds?.length ? locationIds.map(() => '?').join(',') : null;
  const typePh = userScope.typeIds?.length ? userScope.typeIds.map(() => '?').join(',') : null;

  let total_assets;
  let total_locations;
  let total_types;
  let assetsByType;
  let assetsByLocation;
  let recentMovements;
  let tagged;
  let untagged;
  let monthlyDistribution;
  let locationDistribution;

  if (assetWhere.active) {
    const [[ta]] = await db.query(
      `SELECT COUNT(*) AS total_assets FROM assets a WHERE ${assetWhere.sql}`,
      assetWhere.params
    );
    total_assets = ta.total_assets;

    if (locPh) {
      const [[tl]] = await db.query(
        `SELECT COUNT(*) AS total_locations FROM locations WHERE id IN (${locPh})`,
        locationIds
      );
      total_locations = tl.total_locations;
    } else {
      const [[tl]] = await db.query('SELECT COUNT(*) AS total_locations FROM locations');
      total_locations = tl.total_locations;
    }

    if (locPh) {
      const [[tt]] = await db.query(
        `SELECT COUNT(DISTINCT a.asset_type_id) AS total_types
         FROM assets a
         WHERE a.asset_type_id IS NOT NULL AND ${assetWhere.sql}`,
        assetWhere.params
      );
      total_types = tt.total_types;

      [assetsByType] = await db.query(
        `SELECT at.name AS type, COUNT(a.id) AS count
         FROM assets a
         INNER JOIN asset_types at ON a.asset_type_id = at.id
         WHERE ${assetWhere.sql}
         GROUP BY at.id, at.name
         ORDER BY count DESC`,
        assetWhere.params
      );
    } else if (typePh) {
      const [[tt]] = await db.query(
        `SELECT COUNT(*) AS total_types FROM asset_types WHERE id IN (${typePh})`,
        userScope.typeIds
      );
      total_types = tt.total_types;

      const joinExtra = assetWhereNoLocation.active ? ` AND ${assetWhereNoLocation.sql}` : '';
      [assetsByType] = await db.query(
        `SELECT at.name AS type, COUNT(a.id) AS count
         FROM asset_types at
         LEFT JOIN assets a ON a.asset_type_id = at.id${joinExtra}
         WHERE at.id IN (${typePh})
         GROUP BY at.id`,
        [...assetWhereNoLocation.params, ...userScope.typeIds]
      );
    } else {
      const [[tt]] = await db.query('SELECT COUNT(*) AS total_types FROM asset_types');
      total_types = tt.total_types;

      const joinExtra = assetWhereNoLocation.active ? ` AND ${assetWhereNoLocation.sql}` : '';
      [assetsByType] = await db.query(
        `SELECT at.name AS type, COUNT(a.id) AS count
         FROM asset_types at
         LEFT JOIN assets a ON a.asset_type_id = at.id${joinExtra}
         GROUP BY at.id`,
        assetWhereNoLocation.params
      );
    }

    const joinExtra = assetWhereNoLocation.active ? ` AND ${assetWhereNoLocation.sql}` : '';

    const locTableWhere = locPh ? `WHERE l.id IN (${locPh})` : '';
    [assetsByLocation] = await db.query(
      `SELECT l.name AS location, COUNT(a.id) AS count
       FROM locations l
       LEFT JOIN assets a ON a.current_location_id = l.id${joinExtra}
       ${locTableWhere}
       GROUP BY l.id`,
      [...assetWhereNoLocation.params, ...(locPh ? locationIds : [])]
    );

    const movementLoc =
      locPh
        ? `(mh.to_location_id IN (${locPh}) OR mh.from_location_id IN (${locPh}))`
        : null;
    const movementWhere = combineWhere([movementLoc, assetWhere.sql]);
    const movementParams = [...(locPh ? [...locationIds, ...locationIds] : []), ...assetWhere.params];

    [recentMovements] = await db.query(
      `SELECT mh.moved_at, a.name AS asset_name, a.rfid_tag,
        fl.name AS from_location, tl.name AS to_location
       FROM movement_history mh
       JOIN assets a ON mh.asset_id = a.id
       LEFT JOIN locations fl ON mh.from_location_id = fl.id
       LEFT JOIN locations tl ON mh.to_location_id = tl.id
       WHERE ${movementWhere}
       ORDER BY mh.moved_at DESC
       LIMIT 3`,
      movementParams
    );

    const rfidTaggedWhere = combineWhere([
      assetWhere.sql,
      "a.rfid_tag IS NOT NULL AND a.rfid_tag != ''",
    ]);
    const [[tg]] = await db.query(
      `SELECT COUNT(*) AS tagged FROM assets a WHERE ${rfidTaggedWhere}`,
      assetWhere.params
    );
    tagged = tg.tagged;

    const rfidUntaggedWhere = combineWhere([
      assetWhere.sql,
      "(a.rfid_tag IS NULL OR a.rfid_tag = '')",
    ]);
    const [[ut]] = await db.query(
      `SELECT COUNT(*) AS untagged FROM assets a WHERE ${rfidUntaggedWhere}`,
      assetWhere.params
    );
    untagged = ut.untagged;

    const monthWhere = combineWhere([yearSql, assetWhere.sql]);
    const [monthRows] = await db.query(
      `SELECT MONTH(a.created_at) AS month, COUNT(*) AS count
       FROM assets a
       WHERE ${monthWhere}
       GROUP BY MONTH(a.created_at)
       ORDER BY month ASC`,
      [...yearParams, ...assetWhere.params]
    );
    monthlyDistribution = monthRows.map((r) => ({
      month: Number(r.month),
      count: Number(r.count),
    }));

    const locDistJoin = assetWhereNoLocation.active ? ` AND ${assetWhereNoLocation.sql}` : '';
    const locDistTableWhere = locPh ? `WHERE l.id IN (${locPh})` : '';
    const [locDistRows] = await db.query(
      `SELECT l.name AS name, COUNT(a.id) AS count
       FROM locations l
       INNER JOIN assets a ON a.current_location_id = l.id${locDistJoin}
       ${locDistTableWhere}
       GROUP BY l.id, l.name
       ORDER BY count DESC
       LIMIT 100`,
      [...assetWhereNoLocation.params, ...(locPh ? locationIds : [])]
    );
    locationDistribution = locDistRows.map((r) => ({
      name: r.name,
      count: Number(r.count),
    }));
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
      LEFT JOIN locations tl ON mh.to_location_id = tl.id
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

    const [monthRows] = await db.query(
      `SELECT MONTH(a.created_at) AS month, COUNT(*) AS count
       FROM assets a
       WHERE ${yearSql}
       GROUP BY MONTH(a.created_at)
       ORDER BY month ASC`,
      yearParams
    );
    monthlyDistribution = monthRows.map((r) => ({
      month: Number(r.month),
      count: Number(r.count),
    }));

    const [locDistRows] = await db.query(
      `SELECT l.name AS name, COUNT(a.id) AS count
       FROM locations l
       INNER JOIN assets a ON a.current_location_id = l.id
       GROUP BY l.id, l.name
       ORDER BY count DESC
       LIMIT 100`,
      []
    );
    locationDistribution = locDistRows.map((r) => ({
      name: r.name,
      count: Number(r.count),
    }));
  }

  const dashboard_image_url = await fetchUserDashboardImageUrl(userId);

  const body = {
    dashboard_image_url,
    total_assets,
    total_locations,
    total_types,
    assets_by_type: assetsByType,
    assets_by_location: assetsByLocation,
    recent_movements: recentMovements,
    rfid_breakdown: { tagged, untagged },
    monthlyDistribution,
    locationDistribution,
  };
  if (locationMeta) {
    body.location = locationMeta;
  }
  res.json(body);
});

/** Upload or replace the logged-in user's dashboard map image (multipart field: image). */
router.put('/map-image', optionalImageUpload('dashboard_image'), async (req, res, next) => {
  try {
    const userId = getActorUserId(req);
    if (!userId) return deny(res, 'Authentication required', 401);

    const removeImage = truthyFormFlag(req.body.remove_image);
    if (!req.file && !removeImage) {
      return res.status(400).json({ status: false, message: 'Image file is required (field: image)' });
    }

    const [[userRow]] = await db.query('SELECT dashboard_image_url FROM users WHERE id = ?', [userId]);
    if (!userRow) return res.status(404).json({ status: false, message: 'User not found' });

    const dashboard_image_url = await resolveDashboardImageOnUpdate(
      userRow.dashboard_image_url,
      req.file || null,
      removeImage
    );

    await db.query('UPDATE users SET dashboard_image_url = ? WHERE id = ?', [
      dashboard_image_url,
      userId,
    ]);

    await audit.log(
      'Dashboard',
      removeImage ? 'Removed' : 'Modified',
      removeImage ? 'Dashboard map image removed' : 'Dashboard map image updated',
      req.auditUser,
      req.auditUserId
    );

    res.json({ dashboard_image_url });
  } catch (err) {
    next(err);
  }
});

/** Remove the logged-in user's dashboard map image. */
router.delete('/map-image', async (req, res, next) => {
  try {
    const userId = getActorUserId(req);
    if (!userId) return deny(res, 'Authentication required', 401);

    const [[userRow]] = await db.query('SELECT dashboard_image_url FROM users WHERE id = ?', [userId]);
    if (!userRow) return res.status(404).json({ status: false, message: 'User not found' });

    await resolveDashboardImageOnUpdate(userRow.dashboard_image_url, null, true);
    await db.query('UPDATE users SET dashboard_image_url = NULL WHERE id = ?', [userId]);

    await audit.log(
      'Dashboard',
      'Removed',
      'Dashboard map image removed',
      req.auditUser,
      req.auditUserId
    );

    res.json({ dashboard_image_url: null });
  } catch (err) {
    next(err);
  }
});

// Location detail for dashboard popup (map pin / modal)
router.get('/location/:id', async (req, res, next) => {
  try {
    const userId = getActorUserId(req);
    const userScope = req.authz || (await loadUserAuthz(userId)) || {};
    const locationId = parseInt(req.params.id, 10);
    if (Number.isNaN(locationId)) {
      return res.status(400).json({ message: 'Invalid location ID' });
    }
    if (userScope.locationIds && !userScope.locationIds.includes(locationId)) {
      return deny(res, 'You do not have access to this location');
    }

    const { getLocationDashboardDetail } = require('../controllers/locationDetails');
    const detail = await getLocationDashboardDetail(req.params.id, {
      typeIds: userScope.typeIds,
      attrFilters: userScope.attrFilters,
    });
    if (!detail) return res.status(404).json({ message: 'Not found' });
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
