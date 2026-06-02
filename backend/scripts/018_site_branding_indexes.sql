-- Import performance: name lookups and attribute upserts
USE asset;

-- assets.asset_serial should already be UNIQUE from schema_v3; safe no-op if exists
-- CREATE UNIQUE INDEX idx_assets_serial ON assets(asset_serial);

-- Ignore "Duplicate key name" if indexes already exist
CREATE INDEX idx_locations_name ON locations(name);
CREATE INDEX idx_asset_types_name ON asset_types(name);
CREATE INDEX idx_tag_types_name ON tag_types(name);
CREATE INDEX idx_vendors_name ON vendors(name);

-- Singleton row: customizable app logo, name, and subtitle (sidebar + login)
CREATE TABLE IF NOT EXISTS site_branding (
  id           INT PRIMARY KEY DEFAULT 1,
  app_name     VARCHAR(120) NOT NULL DEFAULT 'RFID Asset',
  app_subtitle VARCHAR(120) NOT NULL DEFAULT 'Management System',
  logo_url     VARCHAR(512) DEFAULT NULL,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_site_branding_singleton CHECK (id = 1)
);

INSERT IGNORE INTO site_branding (id, app_name, app_subtitle)
VALUES (1, 'RFID Asset', 'Management System');
