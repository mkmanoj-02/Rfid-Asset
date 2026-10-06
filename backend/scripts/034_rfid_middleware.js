/**
 * RFID middleware schema (RFID Management API spec v2.0) on top of the existing
 * asset database. Idempotent: every change checks information_schema first.
 *
 * - readers / reader_antennas: new spec columns
 * - floor_plans / floor_zones: single-plan (INT id = 1) -> multi-plan (string ids).
 *   Legacy tables are kept as floor_plans_legacy / floor_zones_legacy.
 * - floor_placements / floor_antenna_placements (copied from legacy reader/antenna placement)
 * - tag_events, reader_status_log, api_post_stats, service_state
 * - assets.rfid_last_seen_at (updated by every accepted tag read)
 */

const COLLATE = 'DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci';

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return rows.length > 0;
}

async function columnInfo(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT DATA_TYPE AS dataType, CHARACTER_MAXIMUM_LENGTH AS maxLen
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows[0] || null;
}

async function indexExists(conn, table, index) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [table, index]
  );
  return rows.length > 0;
}

async function constraintExists(conn, name) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = ? LIMIT 1`,
    [name]
  );
  return rows.length > 0;
}

async function addColumn(conn, table, column, definition) {
  if (await columnInfo(conn, table, column)) return;
  await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  console.log(`  + ${table}.${column}`);
}

async function addIndex(conn, table, index, definition) {
  if (await indexExists(conn, table, index)) return;
  await conn.query(`ALTER TABLE \`${table}\` ADD ${definition}`);
  console.log(`  + index ${table}.${index}`);
}

async function addCheck(conn, table, name, expr) {
  if (await constraintExists(conn, name)) return;
  await conn.query(`ALTER TABLE \`${table}\` ADD CONSTRAINT \`${name}\` CHECK (${expr})`);
  console.log(`  + check ${name}`);
}

async function migrateReaders(conn) {
  const name = await columnInfo(conn, 'readers', 'name');
  if (name && Number(name.maxLen) < 128) {
    await conn.query('ALTER TABLE readers MODIFY COLUMN name VARCHAR(128) NOT NULL');
    console.log('  ~ readers.name -> VARCHAR(128)');
  }
  const ip = await columnInfo(conn, 'readers', 'ip_address');
  if (ip && Number(ip.maxLen) < 64) {
    await conn.query('ALTER TABLE readers MODIFY COLUMN ip_address VARCHAR(64) NOT NULL');
    console.log('  ~ readers.ip_address -> VARCHAR(64)');
  }
  await addColumn(conn, 'readers', 'enabled', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER port');
  if (!(await columnInfo(conn, 'readers', 'same_tx_power'))) {
    await addColumn(conn, 'readers', 'same_tx_power', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER tx_power');
    await conn.query(
      `UPDATE readers r SET r.same_tx_power = 1
        WHERE NOT EXISTS (SELECT 1 FROM reader_antennas a WHERE a.reader_id = r.id AND a.tx_power <> r.tx_power)`
    );
  }
  await addColumn(conn, 'readers', 'item_in', 'INT NOT NULL DEFAULT 20000 AFTER item_seen_enabled');
  await addColumn(conn, 'readers', 'item_out', 'INT NOT NULL DEFAULT 20000 AFTER item_in');
  await addColumn(conn, 'readers', 'status', "VARCHAR(20) NOT NULL DEFAULT 'STOPPED' AFTER item_out");
  await addColumn(conn, 'readers', 'last_seen', 'DATETIME(3) NULL AFTER status');
  await addColumn(conn, 'readers', 'tags_read_count', 'BIGINT NOT NULL DEFAULT 0 AFTER last_seen');
  await addColumn(conn, 'readers', 'last_error', 'VARCHAR(500) NULL AFTER tags_read_count');

  await addCheck(
    conn,
    'readers',
    'chk_readers_status',
    "status IN ('STOPPED','RUNNING','CONNECTING','ERROR','DISCONNECTED')"
  );
  await addCheck(conn, 'readers', 'chk_readers_port', 'port BETWEEN 1 AND 65535');
  const [[{ badTypes }]] = await conn.query(
    "SELECT COUNT(*) AS badTypes FROM readers WHERE reader_type NOT IN ('IR-Reader','4-Port Reader')"
  );
  if (Number(badTypes) === 0) {
    await addCheck(conn, 'readers', 'chk_readers_type', "reader_type IN ('IR-Reader','4-Port Reader')");
  } else {
    console.log(`  ! ${badTypes} reader(s) have a non-standard reader_type; chk_readers_type not added`);
  }
  await addIndex(conn, 'readers', 'idx_readers_status', 'INDEX idx_readers_status (status)');
  await addIndex(conn, 'readers', 'idx_readers_last_seen', 'INDEX idx_readers_last_seen (last_seen)');

  await addColumn(conn, 'reader_antennas', 'rx_sensitivity', 'INT NOT NULL DEFAULT -70 AFTER tx_power');
}

async function createFloorTables(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS floor_plans (
      id          VARCHAR(64)  NOT NULL PRIMARY KEY,
      name        VARCHAR(128) NOT NULL,
      image_url   VARCHAR(500) NOT NULL DEFAULT '',
      is_active   TINYINT(1)   NOT NULL DEFAULT 0,
      sort_order  INT          NOT NULL DEFAULT 0,
      created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      INDEX idx_floor_plans_sort (sort_order)
    ) ENGINE=InnoDB ${COLLATE}`);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS floor_zones (
      id             VARCHAR(64)  NOT NULL PRIMARY KEY,
      floor_plan_id  VARCHAR(64)  NOT NULL,
      zone_type      VARCHAR(16)  NOT NULL,
      name           VARCHAR(128) NOT NULL,
      pos_x          DOUBLE       NOT NULL DEFAULT 0,
      pos_y          DOUBLE       NOT NULL DEFAULT 0,
      width          DOUBLE       NOT NULL DEFAULT 220,
      height         DOUBLE       NOT NULL DEFAULT 120,
      sort_order     INT          NOT NULL DEFAULT 0,
      INDEX idx_floor_zones_plan (floor_plan_id),
      CONSTRAINT fk_floor_zone_plan FOREIGN KEY (floor_plan_id)
        REFERENCES floor_plans(id) ON DELETE CASCADE,
      CONSTRAINT chk_floor_zone_type CHECK (zone_type IN ('DOOR','BIN'))
    ) ENGINE=InnoDB ${COLLATE}`);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS floor_placements (
      id             BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
      floor_plan_id  VARCHAR(64) NOT NULL,
      reader_id      INT         NOT NULL,
      placed         TINYINT(1)  NOT NULL DEFAULT 0,
      pos_x          DOUBLE      NOT NULL DEFAULT 0,
      pos_y          DOUBLE      NOT NULL DEFAULT 0,
      UNIQUE KEY uk_floor_reader (floor_plan_id, reader_id),
      INDEX idx_floor_placements_reader (reader_id),
      CONSTRAINT fk_place_plan FOREIGN KEY (floor_plan_id)
        REFERENCES floor_plans(id) ON DELETE CASCADE,
      CONSTRAINT fk_place_reader FOREIGN KEY (reader_id)
        REFERENCES readers(id) ON DELETE CASCADE
    ) ENGINE=InnoDB ${COLLATE}`);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS floor_antenna_placements (
      id              BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      placement_id    BIGINT NOT NULL,
      antenna_number  INT    NOT NULL,
      pos_x           DOUBLE NOT NULL DEFAULT 0,
      pos_y           DOUBLE NOT NULL DEFAULT 0,
      UNIQUE KEY uk_place_antenna (placement_id, antenna_number),
      CONSTRAINT fk_ant_place FOREIGN KEY (placement_id)
        REFERENCES floor_placements(id) ON DELETE CASCADE
    ) ENGINE=InnoDB ${COLLATE}`);
}

async function importLegacyFloorPlan(conn, legacyImage, legacyZones) {
  await conn.query(
    `INSERT IGNORE INTO floor_plans (id, name, image_url, is_active, sort_order, created_at, updated_at)
     VALUES ('floor-1', 'Floor 1', ?, 1, 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [legacyImage || '']
  );
  let order = 0;
  for (const z of legacyZones) {
    await conn.query(
      `INSERT INTO floor_zones
         (id, floor_plan_id, zone_type, name, pos_x, pos_y, width, height, sort_order)
       VALUES (UUID(), 'floor-1', ?, ?, ?, ?, ?, ?, ?)`,
      [z.type, z.name, z.x, z.y, z.width, z.height, order++]
    );
  }
  await conn.query(
    `INSERT IGNORE INTO floor_placements (floor_plan_id, reader_id, placed, pos_x, pos_y)
     SELECT 'floor-1', r.id, r.placed, r.position_x, r.position_y
       FROM readers r
      WHERE r.placed = 1
         OR EXISTS (SELECT 1 FROM reader_antennas a WHERE a.reader_id = r.id AND a.placed = 1)`
  );
  await conn.query(
    `INSERT IGNORE INTO floor_antenna_placements (placement_id, antenna_number, pos_x, pos_y)
     SELECT p.id, a.number, a.position_x, a.position_y
       FROM reader_antennas a
       JOIN floor_placements p ON p.reader_id = a.reader_id AND p.floor_plan_id = 'floor-1'
      WHERE a.placed = 1`
  );
}

async function migrateFloorPlans(conn) {
  const idCol = (await tableExists(conn, 'floor_plans')) ? await columnInfo(conn, 'floor_plans', 'id') : null;
  const isLegacy = idCol && String(idCol.dataType).toLowerCase() === 'int';

  if (isLegacy) {
    if (await tableExists(conn, 'floor_zones')) {
      await conn.query('RENAME TABLE floor_zones TO floor_zones_legacy');
    }
    await conn.query('RENAME TABLE floor_plans TO floor_plans_legacy');
    console.log('  ~ legacy floor_plans/floor_zones renamed to *_legacy');
  }

  await createFloorTables(conn);

  const [[{ planCount }]] = await conn.query('SELECT COUNT(*) AS planCount FROM floor_plans');
  if (Number(planCount) === 0 && (await tableExists(conn, 'floor_plans_legacy'))) {
    const [[plan]] = await conn.query('SELECT image_url FROM floor_plans_legacy WHERE id = 1');
    const legacyImage = plan ? plan.image_url : null;
    let legacyZones = [];
    if (await tableExists(conn, 'floor_zones_legacy')) {
      [legacyZones] = await conn.query('SELECT * FROM floor_zones_legacy ORDER BY id');
    }
    await conn.beginTransaction();
    try {
      await importLegacyFloorPlan(conn, legacyImage, legacyZones);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    }
    console.log(`  + floor-1 created with ${legacyZones.length} zone(s) and legacy placements`);
  }

  const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM floor_plans');
  if (Number(n) === 0) {
    await conn.query(
      `INSERT INTO floor_plans (id, name, image_url, is_active, sort_order, created_at, updated_at)
       VALUES ('floor-1', 'Floor 1', '', 1, 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`
    );
  }
  const [[{ active }]] = await conn.query('SELECT COUNT(*) AS active FROM floor_plans WHERE is_active = 1');
  if (Number(active) === 0) {
    await conn.query(
      'UPDATE floor_plans SET is_active = 1, updated_at = updated_at ORDER BY sort_order, created_at LIMIT 1'
    );
  }
}

async function createEventTables(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS tag_events (
      id                BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
      epc               VARCHAR(128) NOT NULL,
      tid               VARCHAR(128) NOT NULL,
      antenna_port      INT          NOT NULL DEFAULT 0,
      rssi              INT          NOT NULL DEFAULT 0,
      reader_name       VARCHAR(128) NOT NULL,
      reader_type       VARCHAR(64)  NOT NULL DEFAULT '',
      ip_address        VARCHAR(64)  NOT NULL DEFAULT '',
      mode              VARCHAR(32)  NOT NULL,
      location          VARCHAR(128) NOT NULL DEFAULT '',
      zone_name         VARCHAR(128) NOT NULL DEFAULT '',
      previous_zone_name VARCHAR(128) NOT NULL DEFAULT '',
      event_type        VARCHAR(16)  NOT NULL,
      event_time        DATETIME(3)  NOT NULL,
      posted_to_server  TINYINT(1)   NOT NULL DEFAULT 1,
      received_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY uk_tag_event (reader_name, tid, event_type, event_time),
      INDEX idx_tag_events_time (event_time),
      INDEX idx_tag_events_reader_time (reader_name, event_time),
      INDEX idx_tag_events_reader_antenna_time (reader_name, antenna_port, event_time),
      INDEX idx_tag_events_epc (epc),
      INDEX idx_tag_events_tid (tid),
      INDEX idx_tag_events_event_type (event_type),
      CONSTRAINT chk_tag_events_mode CHECK (mode IN ('IN','OUT','MONITORING')),
      CONSTRAINT chk_tag_events_event_type CHECK (event_type IN ('IN','OUT','SEEN'))
    ) ENGINE=InnoDB ${COLLATE}`);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS reader_status_log (
      id           BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
      reader_id    INT          NULL,
      reader_name  VARCHAR(128) NOT NULL,
      presence     VARCHAR(16)  NOT NULL,
      http_method  VARCHAR(8)   NOT NULL DEFAULT 'POST',
      reported_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_reader_status_log_reader_time (reader_name, reported_at),
      INDEX idx_reader_status_log_time (reported_at),
      CONSTRAINT fk_reader_status_log_reader FOREIGN KEY (reader_id)
        REFERENCES readers(id) ON DELETE SET NULL,
      CONSTRAINT chk_reader_status_log_presence CHECK (presence IN ('online','offline'))
    ) ENGINE=InnoDB ${COLLATE}`);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS api_post_stats (
      id                TINYINT     NOT NULL PRIMARY KEY,
      successful_posts  BIGINT      NOT NULL DEFAULT 0,
      failed_posts      BIGINT      NOT NULL DEFAULT 0,
      tags_posted       BIGINT      NOT NULL DEFAULT 0,
      last_post_at      DATETIME(3) NULL,
      CONSTRAINT chk_api_post_stats_singleton CHECK (id = 1)
    ) ENGINE=InnoDB ${COLLATE}`);
  await conn.query('INSERT IGNORE INTO api_post_stats (id) VALUES (1)');

  await conn.query(`
    CREATE TABLE IF NOT EXISTS service_state (
      id          TINYINT     NOT NULL PRIMARY KEY,
      status      VARCHAR(20) NOT NULL DEFAULT 'NOT_CREATED',
      updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      CONSTRAINT chk_service_state_singleton CHECK (id = 1),
      CONSTRAINT chk_service_state_status CHECK (status IN ('NOT_CREATED','STOPPED','RUNNING'))
    ) ENGINE=InnoDB ${COLLATE}`);
  await conn.query(
    "INSERT IGNORE INTO service_state (id, status, updated_at) VALUES (1, 'NOT_CREATED', UTC_TIMESTAMP(3))"
  );
}

async function up(conn) {
  await migrateReaders(conn);
  await migrateFloorPlans(conn);
  await createEventTables(conn);
  await addColumn(conn, 'assets', 'rfid_last_seen_at', 'DATETIME(3) NULL');
}

module.exports = { up };
