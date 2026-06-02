USE asset_management;

-- Vendors master table (e.g. Dell, HP, Cisco, Apple)
CREATE TABLE IF NOT EXISTS vendors (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(255) NOT NULL UNIQUE,
  contact     VARCHAR(255) DEFAULT NULL,
  email       VARCHAR(255) DEFAULT NULL,
  phone       VARCHAR(100) DEFAULT NULL,
  website     VARCHAR(255) DEFAULT NULL,
  description TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Link assets to a vendor (nullable, no cascade delete)
ALTER TABLE assets ADD COLUMN vendor_id INT DEFAULT NULL AFTER tag_type_id;
ALTER TABLE assets ADD CONSTRAINT fk_assets_vendor
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE SET NULL;
