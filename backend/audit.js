const db = require('./db');

async function log(type, action, description, username, userId) {
  try {
    await db.query(
      'INSERT INTO audit_logs (type, action, description, username, user_id) VALUES (?,?,?,?,?)',
      [type, action, description, username || null, userId || null]
    );
  } catch (e) {
    console.error('Audit log error:', e.message);
  }
}

module.exports = { log };
