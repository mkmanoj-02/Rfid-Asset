USE asset_management;

-- Tag types master (e.g. RFID, Barcode, QR)
CREATE TABLE IF NOT EXISTS tag_types (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT IGNORE INTO tag_types (name, description) VALUES
  ('RFID', 'RFID tag'),
  ('Barcode', 'Barcode label'),
  ('QR', 'QR code label');

-- Link assets to a tag type (nullable for existing data)
ALTER TABLE assets ADD COLUMN tag_type_id INT DEFAULT NULL AFTER rfid_tag;
ALTER TABLE assets ADD CONSTRAINT fk_assets_tag_type FOREIGN KEY (tag_type_id) REFERENCES tag_types(id) ON DELETE SET NULL;

