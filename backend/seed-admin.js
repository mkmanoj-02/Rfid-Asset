const db = require('./db');
const bcrypt = require('bcryptjs');

async function seed() {
  const hash = await bcrypt.hash('admin', 10);
  await db.query('DELETE FROM users WHERE username IN (?, ?)', ['admin', 'administrator']);
  await db.query(
    'INSERT INTO users (username, email, password_hash, profile_type) VALUES (?, ?, ?, ?)',
    ['administrator', 'admin@example.com', hash, 'super_admin']
  );
  console.log('Done. Login: administrator / admin');
  process.exit(0);
}

seed().catch(e => { console.error(e); process.exit(1); });
