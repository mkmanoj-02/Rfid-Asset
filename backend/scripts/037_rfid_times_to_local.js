/**
 * RFID timestamps were stored in UTC; the API now stores local time (RFID_TZ_OFFSET,
 * default IST +05:30). Shifts the existing RFID DATETIME columns once.
 *
 * Runs only once per database: completion is recorded in app_migrations.
 */

const { OFFSET } = require('../lib/rfidTime');

const MIGRATION = '037_rfid_times_to_local';

/** Per table: the columns to shift; the first one also orders the update. */
const TABLES = {
  tag_events: ['event_time', 'received_at'],
  reader_status_log: ['reported_at'],
  readers: ['last_seen'],
  api_post_stats: ['last_post_at'],
  service_state: ['updated_at'],
  assets: ['rfid_last_seen_at'],
  floor_plans: ['updated_at', 'created_at'],
};

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length > 0;
}

async function up(conn) {
  await conn.query(
    `CREATE TABLE IF NOT EXISTS app_migrations (
       name       VARCHAR(128) NOT NULL PRIMARY KEY,
       applied_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`
  );
  const [done] = await conn.query('SELECT 1 FROM app_migrations WHERE name = ?', [MIGRATION]);
  if (done.length) {
    console.log('  - already applied');
    return;
  }

  const minutes = (OFFSET.startsWith('-') ? -1 : 1)
    * (Number(OFFSET.slice(1, 3)) * 60 + Number(OFFSET.slice(4, 6)));

  await conn.beginTransaction();
  try {
    for (const [table, wanted] of Object.entries(TABLES)) {
      const columns = [];
      for (const c of wanted) if (await columnExists(conn, table, c)) columns.push(c);
      if (!columns.length) continue;

      const sets = columns.map((c) => `\`${c}\` = \`${c}\` + INTERVAL ${minutes} MINUTE`);
      // Assigning updated_at explicitly stops ON UPDATE CURRENT_TIMESTAMP from overwriting it.
      if (!columns.includes('updated_at') && (await columnExists(conn, table, 'updated_at'))) {
        sets.push('`updated_at` = `updated_at`');
      }
      // Shift the latest rows first so unique keys on the column never collide mid-update.
      const [result] = await conn.query(
        `UPDATE \`${table}\` SET ${sets.join(', ')}
          WHERE \`${columns[0]}\` IS NOT NULL
          ORDER BY \`${columns[0]}\` ${minutes >= 0 ? 'DESC' : 'ASC'}`
      );
      console.log(`  - ${table} (${columns.join(', ')}): ${result.affectedRows} row(s) shifted by ${OFFSET}`);
    }
    await conn.query('INSERT INTO app_migrations (name) VALUES (?)', [MIGRATION]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  }
}

module.exports = { up };
