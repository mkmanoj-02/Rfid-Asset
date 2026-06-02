/**
 * User asset visibility scope (location, asset type, attribute filters).
 * Matches GET /api/assets privilege behavior.
 */

const db = require('../db');

function parsePriv(val) {
  if (!val) return null;
  if (Array.isArray(val)) return val.length ? val : null;
  try {
    const p = JSON.parse(val);
    return p && p.length ? p : null;
  } catch {
    return null;
  }
}

function parseAssetPrivileges(val) {
  if (!val) return null;
  try {
    const ap = typeof val === 'string' ? JSON.parse(val) : val;
    return ap && ap.length ? ap : null;
  } catch {
    return null;
  }
}

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
 * SQL conditions on an assets row alias (default `a`).
 * @param {{ locationIds?: number[]|null, typeIds?: number[]|null, attrFilters?: object[]|null, alias?: string, skip?: Set<string> }} scope
 */
function buildAssetWhereClause(scope = {}) {
  const alias = scope.alias || 'a';
  const skip = scope.skip || new Set();
  const conditions = [];
  const params = [];

  if (!skip.has('location') && scope.locationIds?.length) {
    conditions.push(
      `${alias}.current_location_id IN (${scope.locationIds.map(() => '?').join(',')})`
    );
    params.push(...scope.locationIds);
  }
  if (!skip.has('type') && scope.typeIds?.length) {
    conditions.push(`${alias}.asset_type_id IN (${scope.typeIds.map(() => '?').join(',')})`);
    params.push(...scope.typeIds);
  }
  if (!skip.has('attr') && scope.attrFilters?.length) {
    for (const f of scope.attrFilters) {
      conditions.push(`EXISTS (
        SELECT 1 FROM asset_attribute_values aav
        JOIN asset_type_attributes ata ON aav.attribute_id = ata.id
        WHERE aav.asset_id = ${alias}.id
          AND LOWER(ata.name) = LOWER(?)
          AND LOWER(aav.value) = LOWER(?)
      )`);
      params.push(f.attribute_name, f.value);
    }
  }

  const sql = conditions.length ? conditions.join(' AND ') : '';
  return { sql, params, active: conditions.length > 0 };
}

module.exports = {
  parsePriv,
  parseAssetPrivileges,
  expandWithSubLocations,
  buildAssetWhereClause,
};
