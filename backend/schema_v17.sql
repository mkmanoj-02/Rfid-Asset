USE asset_2;

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
