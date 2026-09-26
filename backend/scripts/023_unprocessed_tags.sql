USE asset_management;

-- Tags that have been scanned/received but not yet assigned to an asset
CREATE TABLE IF NOT EXISTS unprocessed_tags (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  tag_value   VARCHAR(255) NOT NULL,
  source      VARCHAR(100) DEFAULT NULL,
  reader_id   VARCHAR(100) DEFAULT NULL,
  notes       TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_unprocessed_tags_tag_value (tag_value),
  KEY idx_unprocessed_tags_created_at (created_at)
);
