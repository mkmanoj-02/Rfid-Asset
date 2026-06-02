/**
 * Central user authorization: scope (what you see) and action flags (what you can change).
 */

const db = require('../db');
const {
  parsePriv,
  parseAssetPrivileges,
  buildAssetWhereClause,
} = require('./assetScope');

const MODIFY_FLAGS = {
  location: 'location_can_modify',
  location_type: 'location_type_can_modify',
  asset_type: 'asset_type_can_modify',
  asset: 'asset_can_modify',
};

const DELETE_FLAGS = {
  location: 'location_can_delete',
  location_type: 'location_type_can_delete',
  asset_type: 'asset_type_can_delete',
  asset: 'asset_can_delete',
};

function getActorUserId(req) {
  return req.auditUserId || req.user?.id || req.headers['x-user-id'] || req.query?.user_id || null;
}

function deny(res, message, status = 403) {
  return res.status(status).json({ status: false, message });
}

function isSuperAdmin(authz) {
  return Boolean(authz?.isSuperAdmin);
}

function canManageUsers(authz) {
  if (!authz) return false;
  return authz.isSuperAdmin || authz.profileType === 'admin';
}

function canModify(authz, resource) {
  if (!authz) return false;
  if (isSuperAdmin(authz)) return true;
  const col = MODIFY_FLAGS[resource];
  return col ? Boolean(authz.flags[col]) : false;
}

function canDelete(authz, resource) {
  if (!authz) return false;
  if (isSuperAdmin(authz)) return true;
  const col = DELETE_FLAGS[resource];
  return col ? Boolean(authz.flags[col]) : false;
}

function locationAllowed(authz, locationId) {
  if (!authz || isSuperAdmin(authz) || !authz.locationIds) return true;
  if (locationId == null || locationId === '') return false;
  return authz.locationIds.includes(Number(locationId));
}

function assetTypeAllowed(authz, typeId) {
  if (!authz || isSuperAdmin(authz) || !authz.typeIds) return true;
  if (typeId == null || typeId === '') return false;
  return authz.typeIds.includes(Number(typeId));
}

function locationTypeAllowed(authz, locationTypeId) {
  if (!authz || isSuperAdmin(authz) || !authz.locationTypeIds) return true;
  if (locationTypeId == null || locationTypeId === '') return true;
  return authz.locationTypeIds.includes(Number(locationTypeId));
}

function assetRowInScope(authz, row) {
  if (!authz || isSuperAdmin(authz)) return true;
  if (!locationAllowed(authz, row.current_location_id)) return false;
  if (!assetTypeAllowed(authz, row.asset_type_id)) return false;
  return true;
}

async function assetMatchesAttrFilters(authz, assetId) {
  if (!authz?.attrFilters?.length) return true;
  for (const f of authz.attrFilters) {
    const [rows] = await db.query(
      `SELECT 1 FROM asset_attribute_values aav
       JOIN asset_type_attributes ata ON aav.attribute_id = ata.id
       WHERE aav.asset_id = ?
         AND LOWER(ata.name) = LOWER(?)
         AND LOWER(aav.value) = LOWER(?)
       LIMIT 1`,
      [assetId, f.attribute_name, f.value]
    );
    if (!rows.length) return false;
  }
  return true;
}

async function assetInScope(authz, assetId) {
  if (!authz || isSuperAdmin(authz)) return true;
  const [rows] = await db.query(
    'SELECT id, asset_type_id, current_location_id FROM assets WHERE id = ?',
    [assetId]
  );
  if (!rows.length) return false;
  if (!assetRowInScope(authz, rows[0])) return false;
  return assetMatchesAttrFilters(authz, assetId);
}

function assertModify(authz, res, resource) {
  if (!authz) return deny(res, 'Authentication required', 401);
  if (!canModify(authz, resource)) {
    return deny(res, `You do not have permission to modify ${resource.replace('_', ' ')}s`);
  }
  return null;
}

function assertDelete(authz, res, resource) {
  if (!authz) return deny(res, 'Authentication required', 401);
  if (!canDelete(authz, resource)) {
    return deny(res, `You do not have permission to delete ${resource.replace('_', ' ')}s`);
  }
  return null;
}

function assertLocationAccess(authz, res, locationId) {
  if (!authz) return deny(res, 'Authentication required', 401);
  if (!locationAllowed(authz, locationId)) {
    return deny(res, 'You do not have access to this location');
  }
  return null;
}

function assertAssetTypeAccess(authz, res, typeId) {
  if (!authz) return deny(res, 'Authentication required', 401);
  if (!assetTypeAllowed(authz, typeId)) {
    return deny(res, 'You do not have access to this asset type');
  }
  return null;
}

function assertAssetPayload(authz, res, { asset_type_id, current_location_id }) {
  let err = assertAssetTypeAccess(authz, res, asset_type_id);
  if (err) return err;
  err = assertLocationAccess(authz, res, current_location_id);
  return err;
}

async function assertAssetInScope(authz, res, assetId) {
  if (!authz) return deny(res, 'Authentication required', 401);
  const ok = await assetInScope(authz, assetId);
  if (!ok) return deny(res, 'You do not have access to this asset');
  return null;
}

/** Walk up parent_id chain for all allowed location ids (rules with include_sub_locations). */
async function getAncestorLocationIds(locationIds) {
  if (!locationIds?.length) return [];
  const [all] = await db.query('SELECT id, parent_id FROM locations');
  const byId = new Map(all.map((l) => [l.id, l]));
  const ancestors = new Set();
  for (const startId of locationIds) {
    let cur = byId.get(Number(startId));
    while (cur?.parent_id) {
      ancestors.add(cur.parent_id);
      cur = byId.get(cur.parent_id);
    }
  }
  return [...ancestors];
}

/**
 * SQL fragment for rules visible to the user (strict location + optional asset type).
 * @returns {Promise<{ clause: string, params: unknown[], active: boolean }>}
 */
async function buildRuleScopeWhere(authz, alias = 'r') {
  if (!authz || isSuperAdmin(authz)) {
    return { clause: '', params: [], active: false };
  }

  const conditions = [];
  const params = [];

  if (authz.locationIds?.length) {
    const locPh = authz.locationIds.map(() => '?').join(',');
    const ancestors = await getAncestorLocationIds(authz.locationIds);
    let locSql = `${alias}.location_id IN (${locPh})`;
    params.push(...authz.locationIds);
    if (ancestors.length) {
      const ancPh = ancestors.map(() => '?').join(',');
      locSql = `(${locSql} OR (${alias}.include_sub_locations = 1 AND ${alias}.location_id IN (${ancPh})))`;
      params.push(...ancestors);
    }
    conditions.push(locSql);
  }

  if (authz.typeIds?.length) {
    const typePh = authz.typeIds.map(() => '?').join(',');
    conditions.push(`(${alias}.asset_type_id IS NULL OR ${alias}.asset_type_id IN (${typePh}))`);
    params.push(...authz.typeIds);
  }

  return {
    clause: conditions.length ? ` AND ${conditions.join(' AND ')}` : '',
    params,
    active: conditions.length > 0,
  };
}

function ruleRowInScope(authz, row, ancestorLocationIds = []) {
  if (!authz || isSuperAdmin(authz)) return true;
  if (authz.locationIds?.length) {
    const locId = row.location_id != null ? Number(row.location_id) : null;
    if (!locId) return false;
    if (authz.locationIds.includes(locId)) {
      // ok
    } else if (row.include_sub_locations && ancestorLocationIds.includes(locId)) {
      // ok — parent rule includes user's subtree
    } else {
      return false;
    }
  }
  if (authz.typeIds?.length) {
    const typeId = row.asset_type_id != null ? Number(row.asset_type_id) : null;
    if (typeId && !authz.typeIds.includes(typeId)) return false;
  }
  return true;
}

async function assertRuleInScope(authz, res, ruleId) {
  if (!authz) return deny(res, 'Authentication required', 401);
  if (isSuperAdmin(authz)) return null;
  const [rows] = await db.query('SELECT * FROM rules WHERE id = ?', [ruleId]);
  if (!rows.length) return null;
  const ancestors = authz.locationIds?.length
    ? await getAncestorLocationIds(authz.locationIds)
    : [];
  if (!ruleRowInScope(authz, rows[0], ancestors)) {
    return deny(res, 'You do not have access to this rule');
  }
  return null;
}

function assertRulePayload(authz, res, { location_id, asset_type_id }) {
  if (!authz || isSuperAdmin(authz)) return null;
  if (authz.locationIds?.length) {
    if (!location_id) {
      return deny(res, 'Location is required for rules in your scope');
    }
    const err = assertLocationAccess(authz, res, location_id);
    if (err) return err;
  }
  if (asset_type_id) {
    const err = assertAssetTypeAccess(authz, res, asset_type_id);
    if (err) return err;
  }
  return null;
}

/**
 * Movement + asset scope for movement_history queries.
 */
function buildMovementScopeWhere(authz, { movementAlias = 'mh', assetAlias = 'a' } = {}) {
  if (!authz || isSuperAdmin(authz)) {
    return { clause: '', params: [], active: false };
  }

  const conditions = [];
  const params = [];

  if (authz.locationIds?.length) {
    const ph = authz.locationIds.map(() => '?').join(',');
    conditions.push(
      `(${movementAlias}.to_location_id IN (${ph}) OR ${movementAlias}.from_location_id IN (${ph}))`
    );
    params.push(...authz.locationIds, ...authz.locationIds);
  }

  const assetBuilt = buildAssetWhereClause({
    locationIds: null,
    typeIds: authz.typeIds,
    attrFilters: authz.attrFilters,
    alias: assetAlias,
    skip: authz.locationIds?.length ? new Set(['location']) : new Set(),
  });
  if (assetBuilt.active) {
    conditions.push(assetBuilt.sql);
    params.push(...assetBuilt.params);
  } else if (authz.locationIds?.length) {
    const locPh = authz.locationIds.map(() => '?').join(',');
    conditions.push(`${assetAlias}.current_location_id IN (${locPh})`);
    params.push(...authz.locationIds);
  }

  return {
    clause: conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '',
    params,
    active: conditions.length > 0,
  };
}

/**
 * Alerts visible when linked rule, asset, or last_known_location is in scope.
 */
async function buildAlertScopeWhere(authz, alertAlias = 'al') {
  if (!authz || isSuperAdmin(authz)) {
    return { joins: '', clause: '', params: [], active: false };
  }

  const joins = `
    LEFT JOIN rules r ON ${alertAlias}.rule_id = r.id
    LEFT JOIN assets ast ON ${alertAlias}.asset_id = ast.id`;

  const parts = [];
  const params = [];

  const ruleScope = await buildRuleScopeWhere(authz, 'r');
  if (ruleScope.active) {
    parts.push(`(r.id IS NOT NULL${ruleScope.clause})`);
    params.push(...ruleScope.params);
  }

  const assetBuilt = buildAssetWhereClause({
    locationIds: authz.locationIds,
    typeIds: authz.typeIds,
    attrFilters: authz.attrFilters,
    alias: 'ast',
  });
  if (assetBuilt.active) {
    parts.push(`(${alertAlias}.asset_id IS NOT NULL AND ${assetBuilt.sql})`);
    params.push(...assetBuilt.params);
  }

  if (authz.locationIds?.length) {
    const [locs] = await db.query(
      `SELECT name FROM locations WHERE id IN (${authz.locationIds.map(() => '?').join(',')})`,
      authz.locationIds
    );
    const names = locs.map((l) => l.name).filter(Boolean);
    if (names.length) {
      const namePh = names.map(() => '?').join(',');
      parts.push(
        `(${alertAlias}.rule_id IS NULL AND ${alertAlias}.asset_id IS NULL AND ${alertAlias}.last_known_location IN (${namePh}))`
      );
      params.push(...names);
    }
  }

  if (!parts.length) {
    return { joins, clause: ' WHERE 1=0', params: [], active: true };
  }

  return {
    joins,
    clause: ` WHERE (${parts.join(' OR ')})`,
    params,
    active: true,
  };
}

async function assertAlertInScope(authz, res, alertId) {
  if (!authz) return deny(res, 'Authentication required', 401);
  if (isSuperAdmin(authz)) return null;
  const scope = await buildAlertScopeWhere(authz, 'al');
  const [rows] = await db.query(
    `SELECT al.id FROM alerts al ${scope.joins} ${scope.clause} AND al.id = ?`,
    [...scope.params, alertId]
  );
  if (!rows.length) return deny(res, 'You do not have access to this alert');
  return null;
}

/** Merge asset scope into SQL (reports / counts). */
function scopeAssetWhere(authz, alias = 'a', extraConditions = [], extraParams = []) {
  const built = buildAssetWhereClause({
    locationIds: authz?.locationIds ?? null,
    typeIds: authz?.typeIds ?? null,
    attrFilters: authz?.attrFilters ?? null,
    alias,
  });
  const conditions = [...extraConditions];
  const params = [...extraParams];
  if (built.active) {
    conditions.push(built.sql);
    params.push(...built.params);
  }
  return {
    sql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
    active: conditions.length > 0,
  };
}

async function loadUserAuthz(userId) {
  if (!userId) return null;

  const [users] = await db.query(
    `SELECT id, profile_type,
      location_privileges, location_can_modify, location_can_delete,
      location_type_privileges, location_type_can_modify, location_type_can_delete,
      asset_type_privileges, asset_type_can_modify, asset_type_can_delete,
      asset_privileges, asset_can_modify, asset_can_delete
     FROM users WHERE id = ?`,
    [userId]
  );
  if (!users.length) return null;

  const u = users[0];
  const isSuperAdminUser = u.profile_type === 'super_admin';

  let locationIds = null;
  if (!isSuperAdminUser) {
    const baseLoc = parsePriv(u.location_privileges);
    if (baseLoc) locationIds = baseLoc.map(Number);
  }

  return {
    userId: u.id,
    profileType: u.profile_type,
    isSuperAdmin: isSuperAdminUser,
    locationIds,
    locationTypeIds: isSuperAdminUser ? null : parsePriv(u.location_type_privileges),
    typeIds: isSuperAdminUser ? null : parsePriv(u.asset_type_privileges),
    attrFilters: isSuperAdminUser ? null : parseAssetPrivileges(u.asset_privileges),
    flags: {
      location_can_modify: Boolean(u.location_can_modify),
      location_can_delete: Boolean(u.location_can_delete),
      location_type_can_modify: Boolean(u.location_type_can_modify),
      location_type_can_delete: Boolean(u.location_type_can_delete),
      asset_type_can_modify: Boolean(u.asset_type_can_modify),
      asset_type_can_delete: Boolean(u.asset_type_can_delete),
      asset_can_modify: Boolean(u.asset_can_modify),
      asset_can_delete: Boolean(u.asset_can_delete),
    },
  };
}

/** @deprecated use loadUserAuthz — kept for dashboard/assetScope compatibility */
async function getUserAssetScope(userId) {
  const authz = await loadUserAuthz(userId);
  if (!authz) {
    return { locationIds: null, typeIds: null, attrFilters: null };
  }
  return {
    locationIds: authz.locationIds,
    typeIds: authz.typeIds,
    attrFilters: authz.attrFilters,
  };
}

module.exports = {
  getActorUserId,
  deny,
  loadUserAuthz,
  getUserAssetScope,
  isSuperAdmin,
  canManageUsers,
  canModify,
  canDelete,
  locationAllowed,
  assetTypeAllowed,
  locationTypeAllowed,
  assetRowInScope,
  assetInScope,
  assertModify,
  assertDelete,
  assertLocationAccess,
  assertAssetTypeAccess,
  assertAssetPayload,
  assertAssetInScope,
  scopeAssetWhere,
  buildAssetWhereClause,
  getAncestorLocationIds,
  buildRuleScopeWhere,
  ruleRowInScope,
  assertRuleInScope,
  assertRulePayload,
  buildMovementScopeWhere,
  buildAlertScopeWhere,
  assertAlertInScope,
};
