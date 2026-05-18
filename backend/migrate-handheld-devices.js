/**
 * Creates handheld_devices + handheld_device_attributes tables.
 * Run: node migrate-handheld-devices.js
 */
require('dotenv').config();
const db = require('./db');

async function run() {
  const dbName = process.env.DB_DATABASE || process.env.DB_NAME || 'asset_2';
  console.log(`Migrating database: ${dbName}`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS handheld_devices (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      name        VARCHAR(255) NOT NULL,
      description TEXT,
      is_active   TINYINT(1) NOT NULL DEFAULT 1,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_handheld_device_name (name)
    )
  `);
  console.log('✅ handheld_devices');

  await db.query(`
    CREATE TABLE IF NOT EXISTS handheld_device_attributes (
      device_id     INT NOT NULL,
      attribute_id  INT NOT NULL,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (device_id, attribute_id),
      CONSTRAINT fk_hda_device FOREIGN KEY (device_id) REFERENCES handheld_devices(id) ON DELETE CASCADE,
      CONSTRAINT fk_hda_attribute FOREIGN KEY (attribute_id) REFERENCES asset_type_attributes(id) ON DELETE CASCADE
    )
  `);
  console.log('✅ handheld_device_attributes');

  console.log('Handheld devices migration complete.');
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('Migration failed:', e.message);
      process.exit(1);
    });
}

module.exports = run;
