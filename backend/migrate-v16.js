/**
 * Run once: node migrate-v16.js
 * Creates refresh_tokens table for JWT sessions.
 */
require('dotenv').config();
const db = require('./db');

async function migrate() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      refresh_token VARCHAR(512) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_refresh_tokens_user (user_id),
      INDEX idx_refresh_tokens_hash (refresh_token),
      INDEX idx_refresh_tokens_expires (expires_at)
    )
  `);
  console.log('refresh_tokens table ready');
  process.exit(0);
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
