/**
 * Drop columns and tables the RFID API spec v2.0 no longer uses. Idempotent.
 *
 * - readers: location, zone_type, placed, position_x, position_y, floor_plan
 *   (reader placement lives in floor_placements)
 * - reader_antennas: placed, position_x, position_y
 *   (antenna placement lives in floor_antenna_placements)
 * - floor_zones: minimized
 * - floor_plans_legacy, floor_zones_legacy (copied into the new floor tables by 034)
 * - reader_locations (only fed the removed reader location field)
 */

const DROP_COLUMNS = {
  readers: ['location', 'zone_type', 'placed', 'position_x', 'position_y', 'floor_plan'],
  reader_antennas: ['placed', 'position_x', 'position_y'],
  floor_zones: ['minimized'],
};

const DROP_TABLES = ['floor_zones_legacy', 'floor_plans_legacy', 'reader_locations'];

async function existingColumns(conn, table, columns) {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME IN (?)`,
    [table, columns]
  );
  return rows.map((r) => r.name);
}

async function up(conn) {
  const [[newFloor]] = await conn.query(
    `SELECT DATA_TYPE AS dataType FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'floor_plans' AND COLUMN_NAME = 'id'`
  );
  if (!newFloor || String(newFloor.dataType).toLowerCase() === 'int') {
    throw new Error('Run 034_rfid_middleware.js before 035_rfid_spec_cleanup.js');
  }

  for (const [table, columns] of Object.entries(DROP_COLUMNS)) {
    const present = await existingColumns(conn, table, columns);
    if (!present.length) continue;
    await conn.query(
      `ALTER TABLE \`${table}\` ${present.map((c) => `DROP COLUMN \`${c}\``).join(', ')}`
    );
    console.log(`  - ${table}: ${present.join(', ')}`);
  }

  for (const table of DROP_TABLES) {
    const [rows] = await conn.query(
      `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table]
    );
    if (!rows.length) continue;
    await conn.query(`DROP TABLE \`${table}\``);
    console.log(`  - table ${table}`);
  }

  const [junk] = await conn.query("DELETE FROM floor_plans WHERE id = '1' AND name = ''");
  if (junk.affectedRows) console.log("  - stray floor_plans row id '1'");
}

module.exports = { up };
