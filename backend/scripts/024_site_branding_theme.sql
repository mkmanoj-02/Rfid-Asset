-- Site-wide UI theme (blue | purple)
-- Note: migrate.js strips USE statements and runs against DB_* from .env
ALTER TABLE site_branding
  ADD COLUMN theme VARCHAR(32) NOT NULL DEFAULT 'blue' AFTER logo_url;
