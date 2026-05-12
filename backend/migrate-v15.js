require('dotenv').config();
const db = require('./db');

async function run() {
  const cols = [
    ['location_type_privileges',  'TEXT DEFAULT NULL'],
    ['location_type_can_modify',  'TINYINT(1) DEFAULT 1'],
    ['location_type_can_delete',  'TINYINT(1) DEFAULT 1'],
  ];

  for (const [col, def] of cols) {
    try {
      await db.query(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
      console.log(`✅ Added column: ${col}`);
    } catch (e) {
      console.log(`ℹ️  Column already exists (${col}): ${e.message}`);
    }
  }

  console.log('Migration v15 complete.');
}

if (require.main === module) {
  run().then(() => process.exit(0)).catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
}

module.exports = run;
