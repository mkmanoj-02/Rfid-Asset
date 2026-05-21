const db = require('../db');

/**
 * Flat location list with parent and type names (no privilege filter).
 */
async function getLocationList() {
  const [rows] = await db.query(
    `SELECT l.*, p.name AS parent_name, lt.name AS location_type_name
     FROM locations l
     LEFT JOIN locations p ON l.parent_id = p.id
     LEFT JOIN location_types lt ON l.location_type_id = lt.id
     ORDER BY l.parent_id, l.name`
  );
  return rows;
}

/**
 * Build nested tree from flat location rows.
 */
function buildLocationTree(items, parentId = null) {
  return items
    .filter((i) => (i.parent_id || null) == parentId)
    .map((i) => ({
      ...i,
      children: buildLocationTree(items, i.id),
    }));
}

/**
 * Single location with parent and type names.
 */
async function getLocationById(id) {
  const [rows] = await db.query(
    `SELECT l.*, p.name AS parent_name, lt.name AS location_type_name
     FROM locations l
     LEFT JOIN locations p ON l.parent_id = p.id
     LEFT JOIN location_types lt ON l.location_type_id = lt.id
     WHERE l.id = ?
     LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

/**
 * All locations as nested tree (no privilege filter).
 */
async function getLocationTree() {
  const [rows] = await db.query(
    'SELECT * FROM locations ORDER BY parent_id, name'
  );
  return buildLocationTree(rows);
}

module.exports = {
  getLocationList,
  getLocationTree,
  getLocationById,
  buildLocationTree,
};
