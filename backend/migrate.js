/**
 * Run all SQL migrations in backend/scripts/ in order.
 * Usage: node migrate.js
 *        node migrate.js 034_rfid_middleware.js   (run only the named file(s))
 *        npm run migrate
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const SCRIPTS_DIR = path.join(__dirname, 'scripts');

const files = [
  '001_base_schema.sql',
  '002_locations_tree_attributes.sql',
  '003_asset_serial.sql',
  '004_attribute_default_value.sql',
  '005_users.sql',
  '006_administrator_user.sql',
  '007_users_email_nullable.sql',
  '008_rules_alerts.sql',
  '009_login_logs.sql',
  '010_audit_logs.sql',
  '011_location_types.sql',
  '012_asset_types_hierarchy.sql',
  '013_tag_types.sql',
  '014_vendors.sql',
  '015_handheld_devices.sql',
  '016_user_location_type_privileges.sql',
  '017_refresh_tokens.sql',
  '018_site_branding_indexes.sql',
  '019_depreciation.sql',
  '020_dashboard_image.sql',
  '021_movement_to_location_nullable.sql',
  '022_asset_types_unique_name.sql',
  '023_unprocessed_tags.sql',
  '024_site_branding_theme.sql',
  '025_audit_logs_type_enum.sql',
  '026_site_branding_favicon.sql',
  '028_zones.sql',
  '029_readers_floor_plan.sql',
  '030_asset_attachments.sql',
  '031_unassigned_tags.sql',
  '032_handheld_devices_platform.sql',
  '033_asset_code.sql',
  '034_rfid_middleware.js',
  '035_rfid_spec_cleanup.js',
  '036_merge_asset_serial.js',
];

/** MySQL errors that are safe to skip when re-running migrations. */
const IGNORABLE_CODES = new Set([
  'ER_DUP_FIELDNAME',
  'ER_DUP_KEYNAME',
  'ER_DUP_INDEX',
  'ER_TABLE_EXISTS_ERROR',
  'ER_DUP_ENTRY',
  'ER_FK_DUP_NAME',
  'ER_CANT_DROP_FIELD_OR_KEY',
  'ER_MULTIPLE_PRI_KEY',
  'ER_CANT_CREATE_TABLE',
]);

function stripUseStatements(sql) {
  return sql.replace(/^\s*USE\s+[`\w]+\s*;\s*$/gim, '').trim();
}

function splitStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^--/.test(s));
}

function isIgnorable(err) {
  if (IGNORABLE_CODES.has(err.code)) return true;
  const msg = String(err.message || '');
  if (err.errno === 121 || /errno:\s*121/i.test(msg)) return true;
  if (/Duplicate column name/i.test(msg)) return true;
  if (/Duplicate key name/i.test(msg)) return true;
  if (/Duplicate foreign key/i.test(msg)) return true;
  if (/already exists/i.test(msg)) return true;
  return false;
}

async function createConnection() {
  const database = process.env.DB_DATABASE || process.env.DB_NAME || 'asset_management';
  return mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    port: Number(process.env.DB_PORT) || 3306,
    database,
    multipleStatements: true,
  });
}

async function runStatement(conn, sql) {
  try {
    await conn.query(sql);
  } catch (err) {
    if (!isIgnorable(err)) throw err;
    const preview = sql.replace(/\s+/g, ' ').slice(0, 72);
    console.log(`  ℹ️  Skipped (${err.code || 'ignored'}): ${preview}...`);
  }
}

async function runFile(conn, filename) {
  const filePath = path.join(SCRIPTS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing migration script: ${filename}`);
  }
  if (filename.endsWith('.js')) {
    const migration = require(filePath);
    await migration.up(conn);
    return;
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const sql = stripUseStatements(raw);
  const statements = splitStatements(sql);
  for (const stmt of statements) {
    await runStatement(conn, stmt.endsWith(';') ? stmt : `${stmt};`);
  }
}

async function run() {
  const database = process.env.DB_DATABASE || process.env.DB_NAME || 'asset_management';
  console.log(`Migrating database: ${database}`);

  const conn = await createConnection();
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\``);
    await conn.query(`USE \`${database}\``);

    const only = process.argv.slice(2);
    const selected = only.length ? files.filter((f) => only.includes(f)) : files;
    if (only.length && selected.length !== only.length) {
      throw new Error(`Unknown migration(s): ${only.filter((f) => !files.includes(f)).join(', ')}`);
    }

    for (const file of selected) {
      console.log(`\n▶ ${file}`);
      await runFile(conn, file);
      console.log(`✅ ${file}`);
    }

    console.log('\nAll migrations complete.');
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\nMigration failed:', err.message);
      process.exit(1);
    });
}

module.exports = { run, files };
