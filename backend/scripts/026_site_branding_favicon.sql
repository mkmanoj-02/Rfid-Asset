-- Site favicon (browser tab icon)
-- Note: migrate.js strips USE statements and runs against DB_* from .env
ALTER TABLE site_branding
  ADD COLUMN favicon_url VARCHAR(512) DEFAULT NULL AFTER logo_url;
