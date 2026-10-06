/**
 * Merge Asset Serial into Asset ID (asset_code). Idempotent.
 *
 * - Every asset type with serialised assets gets an "Asset Serial" string attribute,
 *   and each existing serial is copied into it (an existing non-empty value wins).
 * - Where asset_code is still the auto-generated AST-000000 code, the serial becomes
 *   the Asset ID, unless another asset already uses that code.
 * - assets.asset_serial is left in place (unused) so the change can be rolled back.
 */

const ATTRIBUTE_NAME = 'Asset Serial';
const SERIAL = 'TRIM(a.asset_serial)';

async function up(conn) {
  const [cols] = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assets' AND COLUMN_NAME = 'asset_serial'`
  );
  if (!cols.length) return;

  const [types] = await conn.query(
    `SELECT DISTINCT a.asset_type_id AS typeId
       FROM assets a
      WHERE a.asset_type_id IS NOT NULL AND a.asset_serial IS NOT NULL AND ${SERIAL} <> ''`
  );

  let createdAttrs = 0;
  for (const { typeId } of types) {
    const [found] = await conn.query(
      `SELECT id FROM asset_type_attributes WHERE asset_type_id = ? AND LOWER(TRIM(name)) = ? LIMIT 1`,
      [typeId, ATTRIBUTE_NAME.toLowerCase()]
    );
    if (found.length) continue;
    const [[{ nextOrder }]] = await conn.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS nextOrder FROM asset_type_attributes WHERE asset_type_id = ?`,
      [typeId]
    );
    await conn.query(
      `INSERT INTO asset_type_attributes (asset_type_id, name, attr_type, sort_order) VALUES (?, ?, 'string', ?)`,
      [typeId, ATTRIBUTE_NAME, nextOrder]
    );
    createdAttrs += 1;
  }
  if (createdAttrs) console.log(`  - "${ATTRIBUTE_NAME}" attribute added to ${createdAttrs} asset type(s)`);

  const [copied] = await conn.query(
    `INSERT INTO asset_attribute_values (asset_id, attribute_id, value)
     SELECT a.id, ata.id, ${SERIAL}
       FROM assets a
       JOIN asset_type_attributes ata
         ON ata.id = (SELECT MIN(x.id) FROM asset_type_attributes x
                       WHERE x.asset_type_id = a.asset_type_id AND LOWER(TRIM(x.name)) = ?)
      WHERE a.asset_serial IS NOT NULL AND ${SERIAL} <> ''
     ON DUPLICATE KEY UPDATE value = COALESCE(NULLIF(asset_attribute_values.value, ''), VALUES(value))`,
    [ATTRIBUTE_NAME.toLowerCase()]
  );
  if (copied.affectedRows) console.log(`  - serial copied into attribute values (${copied.affectedRows} row change(s))`);

  const [clashes] = await conn.query(
    `SELECT a.id, a.asset_code AS code, ${SERIAL} AS serial
       FROM assets a
       JOIN assets b ON b.asset_code = ${SERIAL} AND b.id <> a.id
      WHERE a.asset_code REGEXP '^AST-[0-9]{6}$' AND a.asset_serial IS NOT NULL AND ${SERIAL} <> ''`
  );

  const [promoted] = await conn.query(
    `UPDATE assets a
       LEFT JOIN assets b ON b.asset_code = ${SERIAL} AND b.id <> a.id
        SET a.asset_code = ${SERIAL}
      WHERE a.asset_code REGEXP '^AST-[0-9]{6}$'
        AND a.asset_serial IS NOT NULL AND ${SERIAL} <> ''
        AND CHAR_LENGTH(${SERIAL}) <= 100
        AND b.id IS NULL`
  );
  if (promoted.affectedRows) console.log(`  - serial used as Asset ID for ${promoted.affectedRows} asset(s)`);
  for (const c of clashes) {
    console.log(`  ! asset ${c.id} kept ${c.code}: serial "${c.serial}" is already another asset's ID`);
  }
}

module.exports = { up };
