const db = require('../db');

/** Expand location id(s) to include all descendant sub-locations. */
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

async function loadListOptionsByAttributeIds(attributeIds) {
  const map = new Map();
  if (!attributeIds.length) return map;
  const ph = attributeIds.map(() => '?').join(',');
  const [opts] = await db.query(
    `SELECT * FROM attribute_list_options WHERE attribute_id IN (${ph}) ORDER BY attribute_id, sort_order, id`,
    attributeIds
  );
  for (const o of opts) {
    if (!map.has(o.attribute_id)) map.set(o.attribute_id, []);
    map.get(o.attribute_id).push(o);
  }
  return map;
}

/** Attach `attributes` array to each asset row (same shape as GET /api/assets). */
async function attachAssetAttributeValues(assetRows) {
  if (!assetRows.length) return;
  const ids = [...new Set(assetRows.map((r) => r.id).filter((id) => id != null))];
  if (!ids.length) return;
  const ph = ids.map(() => '?').join(',');
  const [values] = await db.query(
    `SELECT aav.*, ata.name, ata.attr_type
     FROM asset_attribute_values aav
     JOIN asset_type_attributes ata ON aav.attribute_id = ata.id
     WHERE aav.asset_id IN (${ph})
     ORDER BY ata.sort_order ASC, ata.id ASC`,
    ids
  );
  const listAttrIds = [...new Set(values.filter((v) => v.attr_type === 'list').map((v) => v.attribute_id))];
  const optionsByAttrId = await loadListOptionsByAttributeIds(listAttrIds);
  const byAsset = new Map(ids.map((id) => [id, []]));
  for (const row of values) {
    const entry = { ...row };
    entry.list_options =
      row.attr_type === 'list' ? optionsByAttrId.get(row.attribute_id) || [] : [];
    byAsset.get(row.asset_id).push(entry);
  }
  for (const a of assetRows) {
    a.attributes = byAsset.get(a.id) || [];
  }
}

/**
 * Assets at a location (and its sub-locations), with joined names and attributes.
 */
async function getAssetsByLocationId(locationId) {
  const locId = Number(locationId);
  if (!Number.isFinite(locId) || locId <= 0) {
    return { error: 'Invalid location id' };
  }

  const locationIds = await expandWithSubLocations([locId]);

  const lastSeenSubquery = `(SELECT MAX(mh.moved_at) FROM movement_history mh WHERE mh.asset_id = a.id)`;
  const ph = locationIds.map(() => '?').join(',');

  const [rows] = await db.query(
    `SELECT a.*, at.name AS asset_type_name, l.name AS location_name, tt.name AS tag_type_name, v.name AS vendor_name,
      ${lastSeenSubquery} AS lastseen
     FROM assets a
     LEFT JOIN asset_types at ON a.asset_type_id = at.id
     LEFT JOIN locations l ON a.current_location_id = l.id
     LEFT JOIN tag_types tt ON a.tag_type_id = tt.id
     LEFT JOIN vendors v ON a.vendor_id = v.id
     WHERE a.current_location_id IN (${ph})
     ORDER BY a.name ASC, a.id DESC`,
    locationIds
  );

  await attachAssetAttributeValues(rows);
  return { assets: rows, locationIds };
}

module.exports = {
  expandWithSubLocations,
  attachAssetAttributeValues,
  getAssetsByLocationId,
};
