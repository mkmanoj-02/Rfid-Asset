/**
 * Dashboard location detail payload for map pin / modal.
 */

const db = require('../db');
const { buildAssetWhereClause } = require('../lib/assetScope');

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

/**
 * Build location detail response for GET /api/dashboard/location/:id
 * @param {number|string} locationId
 * @param {{ typeIds?: number[]|null, attrFilters?: object[]|null }} [assetScope]
 */
async function getLocationDashboardDetail(locationId, assetScope = null) {
  const id = Number(locationId);
  const typeIds = assetScope?.typeIds || null;
  const attrFilters = assetScope?.attrFilters || null;
  const assetWhereNoLocation = buildAssetWhereClause({
    typeIds,
    attrFilters,
    alias: 'a',
  });
  const assetJoinFilter = assetWhereNoLocation.active ? ` AND ${assetWhereNoLocation.sql}` : '';
  const assetFilterParams = assetWhereNoLocation.params;
  const [[loc]] = await db.query(
    `SELECT l.*, p.name AS parent_name, lt.name AS location_type_name
     FROM locations l
     LEFT JOIN locations p ON l.parent_id = p.id
     LEFT JOIN location_types lt ON l.location_type_id = lt.id
     WHERE l.id = ?`,
    [id]
  );
  if (!loc) return null;

  const [[assetStats]] = await db.query(
    `SELECT
       COUNT(*) AS asset_count,
       SUM(CASE WHEN a.status = 'active' THEN 1 ELSE 0 END) AS active_assets,
       SUM(CASE WHEN a.status = 'maintenance' THEN 1 ELSE 0 END) AS maintenance_assets,
       SUM(CASE WHEN a.status = 'inactive' THEN 1 ELSE 0 END) AS inactive_assets
     FROM assets a
     WHERE a.current_location_id = ?${assetJoinFilter}`,
    [id, ...assetFilterParams]
  );

  const [[{ child_locations_count }]] = await db.query(
    'SELECT COUNT(*) AS child_locations_count FROM locations WHERE parent_id = ?',
    [id]
  );

  const [subLocs] = await db.query(
    `SELECT l.id, l.name, l.image_url, COUNT(a.id) AS count
     FROM locations l
     LEFT JOIN assets a ON a.current_location_id = l.id${assetJoinFilter}
     WHERE l.parent_id = ?
     GROUP BY l.id
     ORDER BY l.name`,
    [...assetFilterParams, id]
  );

  const typePh = typeIds?.length ? typeIds.map(() => '?').join(',') : null;
  const byTypeParams = [id, ...assetFilterParams, ...(typePh ? typeIds : [])];
  const [byType] = await db.query(
    `SELECT at.name, COUNT(a.id) AS count
     FROM assets a
     JOIN asset_types at ON a.asset_type_id = at.id
     WHERE a.current_location_id = ?${assetJoinFilter}${typePh ? ` AND at.id IN (${typePh})` : ''}
     GROUP BY at.id
     ORDER BY count DESC
     LIMIT 8`,
    byTypeParams
  );

  const recentTxWhere = assetWhereNoLocation.active
    ? `(mh.to_location_id = ? OR mh.from_location_id = ?) AND ${assetWhereNoLocation.sql}`
    : 'mh.to_location_id = ? OR mh.from_location_id = ?';
  const recentTxParams = assetWhereNoLocation.active
    ? [id, id, ...assetFilterParams]
    : [id, id];

  const [recentTx] = await db.query(
    `SELECT mh.moved_at, a.name AS asset_name, a.asset_serial,
      fl.name AS from_loc, tl.name AS to_loc
     FROM movement_history mh
     JOIN assets a ON mh.asset_id = a.id
     LEFT JOIN locations fl ON mh.from_location_id = fl.id
     LEFT JOIN locations tl ON mh.to_location_id = tl.id
     WHERE ${recentTxWhere}
     ORDER BY mh.moved_at DESC
     LIMIT 5`,
    recentTxParams
  );

  const [recentAlerts] = await db.query(
    `SELECT * FROM alerts WHERE last_known_location = ? ORDER BY alert_time DESC LIMIT 5`,
    [loc.name]
  );

  return {
    id: loc.id,
    name: loc.name,
    description: loc.description || '',
    image_url: loc.image_url || null,
    parent_location: loc.parent_name || null,
    parent_id: loc.parent_id,
    location_type: loc.location_type_name || null,
    asset_count: Number(assetStats.asset_count) || 0,
    active_assets: Number(assetStats.active_assets) || 0,
    maintenance_assets: Number(assetStats.maintenance_assets) || 0,
    inactive_assets: Number(assetStats.inactive_assets) || 0,
    child_locations_count: Number(child_locations_count) || 0,
    sub_locations: subLocs,
    assets_by_type: byType,
    recent_transactions: recentTx,
    recent_alerts: recentAlerts,
    // Legacy fields for older clients
    loc,
    total: Number(assetStats.asset_count) || 0,
    missing: Number(assetStats.inactive_assets) || 0,
    subLocs,
    byType,
    recentTx,
    recentAlerts,
  };
}

module.exports = { getLocationDashboardDetail, expandWithSubLocations };
