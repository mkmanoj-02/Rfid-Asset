const express = require('express');
const router = express.Router();
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

/**
 * GET /api/attribute-list
 *
 * Unique attribute definitions from asset_type_attributes:
 * - Case-sensitive: "mdate" and "Mdate" are distinct (both can appear).
 * - Exact duplicates (same trimmed string + same case): keep MIN(id) only.
 * - No LOWER()/UPPER() in SQL.
 *
 * Query: optional asset_type_id (scope to one type), user_id (non–super_admin: allowed types only).
 */
router.get('/', async (req, res, next) => {
  try {
    const { asset_type_id, user_id } = req.query;
    let allowedTypeIds = null;

    if (user_id) {
      const [users] = await db.query(
        'SELECT asset_type_privileges, profile_type FROM users WHERE id = ?',
        [user_id]
      );
      if (users.length && users[0].profile_type !== 'super_admin') {
        allowedTypeIds = parsePriv(users[0].asset_type_privileges);
      }
    }

    const innerConditions = [];
    const innerParams = [];

    if (asset_type_id !== undefined && asset_type_id !== null && asset_type_id !== '') {
      innerConditions.push('asset_type_id = ?');
      innerParams.push(asset_type_id);
    }
    if (allowedTypeIds) {
      innerConditions.push(`asset_type_id IN (${allowedTypeIds.map(() => '?').join(',')})`);
      innerParams.push(...allowedTypeIds);
    }

    const innerWhere = innerConditions.length ? `WHERE ${innerConditions.join(' AND ')}` : '';

    const sql = `
      SELECT a.id, a.name, a.attr_type
      FROM asset_type_attributes a
      INNER JOIN (
        SELECT MIN(id) AS id
        FROM asset_type_attributes
        ${innerWhere}
        GROUP BY BINARY TRIM(name)
      ) b ON a.id = b.id
      ORDER BY a.name ASC
    `;

    const [rows] = await db.query(sql, innerParams);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
