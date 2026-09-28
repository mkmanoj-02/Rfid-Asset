USE asset_management;

CREATE TABLE IF NOT EXISTS unassigned_tags (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  tag_value   VARCHAR(255) NOT NULL,
  source      VARCHAR(100) DEFAULT NULL,
  reader_id   VARCHAR(100) DEFAULT NULL,
  zone_id     INT DEFAULT NULL,
  notes       TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_unassigned_tags_tag_value (tag_value),
  KEY idx_unassigned_tags_created_at (created_at),
  KEY idx_unassigned_tags_zone_id (zone_id),
  CONSTRAINT fk_unassigned_tags_zone FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS unprocessed_tags (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  tag_value   VARCHAR(255) NOT NULL,
  source      VARCHAR(100) DEFAULT NULL,
  reader_id   VARCHAR(100) DEFAULT NULL,
  notes       TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT IGNORE INTO unassigned_tags (tag_value, source, reader_id, notes, created_at)
SELECT tag_value, source, reader_id, notes, created_at FROM unprocessed_tags;

DROP TABLE IF EXISTS unprocessed_tags;
