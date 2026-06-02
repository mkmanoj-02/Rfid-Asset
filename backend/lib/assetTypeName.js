/** Global (case-insensitive) uniqueness for asset_types.name — not scoped by parent. */

function normalizeAssetTypeName(name) {
  return String(name || '').trim();
}

async function findAssetTypeNameConflict(dbOrConn, name, excludeId = null) {
  const normalized = normalizeAssetTypeName(name);
  if (!normalized) return null;

  const sql = excludeId
    ? 'SELECT id, name FROM asset_types WHERE LOWER(TRIM(name)) = LOWER(?) AND id != ? LIMIT 1'
    : 'SELECT id, name FROM asset_types WHERE LOWER(TRIM(name)) = LOWER(?) LIMIT 1';
  const params = excludeId ? [normalized, excludeId] : [normalized];
  const [rows] = await dbOrConn.query(sql, params);
  return rows[0] || null;
}

module.exports = {
  normalizeAssetTypeName,
  findAssetTypeNameConflict,
};
