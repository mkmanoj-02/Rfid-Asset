const express = require('express');
const router = express.Router();
const db = require('../db');
const { trimAttrName } = require('../attributeNameUtil');
const { filterAttributesByPrivilege } = require('../lib/assetScope');

function buildAttributeScope(asset_type_id, allowedTypeIds) {
  const conditions = [];
  const params = [];
  if (asset_type_id !== undefined && asset_type_id !== null && asset_type_id !== '') {
    conditions.push('asset_type_id = ?');
    params.push(asset_type_id);
  }
  if (allowedTypeIds?.length) {
    conditions.push(`asset_type_id IN (${allowedTypeIds.map(() => '?').join(',')})`);
    params.push(...allowedTypeIds);
  }
  return {
    where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

/** Merge list option rows into deduped { option_value, sort_order } per attribute name. */
function groupListOptionsByName(optionRows) {
  const byName = new Map();
  for (const row of optionRows) {
    const name = trimAttrName(row.name);
    if (!byName.has(name)) byName.set(name, new Map());
    const seen = byName.get(name);
    const key = String(row.option_value).trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.set(key, {
      option_value: String(row.option_value).trim(),
      sort_order: row.sort_order ?? 0,
    });
  }
  const out = new Map();
  for (const [name, valueMap] of byName) {
    out.set(
      name,
      [...valueMap.values()].sort((a, b) => a.sort_order - b.sort_order || a.option_value.localeCompare(b.option_value))
    );
  }
  return out;
}

/**
 * GET /api/attribute-list
 *
 * Unique attribute definitions from asset_type_attributes:
 * - Case-sensitive: "mdate" and "Mdate" are distinct (both can appear).
 * - Exact duplicates (same trimmed string + same case): keep MIN(id) only.
 * - list-type attributes include merged list_options (for privilege / dropdown UI).
 *
 * Query: optional asset_type_id (scope to one type).
 */
router.get('/', async (req, res, next) => {
  try {
    const { asset_type_id } = req.query;
    const allowedTypeIds = req.authz?.typeIds ?? null;
    const scope = buildAttributeScope(asset_type_id, allowedTypeIds);

    const sql = `
      SELECT a.id, a.name, a.attr_type
      FROM asset_type_attributes a
      INNER JOIN (
        SELECT MIN(id) AS id
        FROM asset_type_attributes
        ${scope.where}
        GROUP BY BINARY TRIM(name)
      ) b ON a.id = b.id
      ORDER BY a.name ASC
    `;

    const [rows] = await db.query(sql, scope.params);

    const listScopeWhere = scope.where
      ? `${scope.where} AND attr_type = 'list'`
      : `WHERE attr_type = 'list'`;

    const [optionRows] = await db.query(
      `SELECT TRIM(ata.name) AS name, alo.option_value, alo.sort_order
       FROM asset_type_attributes ata
       INNER JOIN attribute_list_options alo ON alo.attribute_id = ata.id
       ${listScopeWhere}
       ORDER BY ata.name ASC, alo.sort_order ASC, alo.id ASC`,
      scope.params
    );

    const optionsByName = groupListOptionsByName(optionRows);

    const payload = rows.map((row) => ({
      ...row,
      list_options: row.attr_type === 'list'
        ? (optionsByName.get(trimAttrName(row.name)) || [])
        : [],
    }));

    res.json(filterAttributesByPrivilege(payload, req.authz));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
