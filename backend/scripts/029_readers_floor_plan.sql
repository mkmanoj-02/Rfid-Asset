CREATE TABLE IF NOT EXISTS readers (
  id                  INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name                VARCHAR(120) NOT NULL,
  reader_type         VARCHAR(40)  NOT NULL,
  ip_address          VARCHAR(45)  NOT NULL,
  port                INT          NOT NULL DEFAULT 2022,
  location            VARCHAR(120) DEFAULT NULL,
  zone_type           VARCHAR(120) DEFAULT NULL,
  mode                VARCHAR(20)  NOT NULL DEFAULT 'IN',
  antenna_count       INT          NOT NULL DEFAULT 4,
  tx_power            INT          NOT NULL DEFAULT 30,
  read_duration       INT          NOT NULL DEFAULT 1000,
  item_seen           INT          NOT NULL DEFAULT 20,
  item_seen_enabled   TINYINT(1)   NOT NULL DEFAULT 1,
  connection_status   VARCHAR(20)  NOT NULL DEFAULT 'DISCONNECTED',
  placed              TINYINT(1)   NOT NULL DEFAULT 0,
  position_x          INT          NOT NULL DEFAULT 0,
  position_y          INT          NOT NULL DEFAULT 0,
  floor_plan          TEXT,
  created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_readers_name (name),
  CONSTRAINT readers_antenna_count_check CHECK (antenna_count BETWEEN 1 AND 32),
  CONSTRAINT readers_mode_check CHECK (mode IN ('IN', 'OUT', 'MONITORING'))
);

CREATE TABLE IF NOT EXISTS reader_antennas (
  id          INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  reader_id   INT NOT NULL,
  number      INT NOT NULL,
  tx_power    INT NOT NULL,
  enabled     TINYINT(1) NOT NULL DEFAULT 1,
  placed      TINYINT(1) NOT NULL DEFAULT 0,
  position_x  INT NOT NULL DEFAULT 0,
  position_y  INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_reader_antennas_reader_number (reader_id, number),
  CONSTRAINT fk_reader_antennas_reader
    FOREIGN KEY (reader_id) REFERENCES readers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS floor_plans (
  id          INT NOT NULL PRIMARY KEY DEFAULT 1,
  image_url   TEXT,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_floor_plans_singleton CHECK (id = 1)
);

INSERT IGNORE INTO floor_plans (id, image_url)
SELECT 1, NULL FROM DUAL
WHERE (SELECT DATA_TYPE FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'floor_plans' AND COLUMN_NAME = 'id') = 'int';

CREATE TABLE IF NOT EXISTS floor_zones (
  id             INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  floor_plan_id  INT NOT NULL,
  type           VARCHAR(10) NOT NULL,
  name           VARCHAR(120) NOT NULL,
  x              INT NOT NULL,
  y              INT NOT NULL,
  width          INT NOT NULL,
  height         INT NOT NULL,
  minimized      TINYINT(1) NOT NULL DEFAULT 0,
  CONSTRAINT fk_floor_zones_plan
    FOREIGN KEY (floor_plan_id) REFERENCES floor_plans(id) ON DELETE CASCADE,
  CONSTRAINT floor_zones_type_check CHECK (type IN ('DOOR', 'BIN'))
);
