/**
 * Run once: node migrate-v17.js
 * Creates site_branding table for logo / app name customization.
 */
require('dotenv').config();
const db = require('./db');

async function migrate() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS site_branding (
      id           INT PRIMARY KEY DEFAULT 1,
      app_name     VARCHAR(120) NOT NULL DEFAULT 'RFID Asset',
      app_subtitle VARCHAR(120) NOT NULL DEFAULT 'Management System',
      logo_url     VARCHAR(512) DEFAULT NULL,
      updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT chk_site_branding_singleton CHECK (id = 1)
    )
  `);
  await db.query(`
    INSERT IGNORE INTO site_branding (id, app_name, app_subtitle)
    VALUES (1, 'RFID Asset', 'Management System')
  `);
  console.log('site_branding table ready');
  process.exit(0);
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
