USE asset_management;

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  profile_type ENUM('super_admin','admin','normal') NOT NULL DEFAULT 'normal',
  -- Location privileges: NULL = all locations, else JSON array of location ids
  location_privileges JSON DEFAULT NULL,
  location_can_modify TINYINT(1) DEFAULT 1,
  location_can_delete TINYINT(1) DEFAULT 1,
  -- Asset type privileges: NULL = all, else JSON array of asset_type ids
  asset_type_privileges JSON DEFAULT NULL,
  asset_type_can_modify TINYINT(1) DEFAULT 1,
  asset_type_can_delete TINYINT(1) DEFAULT 1,
  -- Asset privileges: NULL = all, else JSON array of asset ids
  asset_privileges JSON DEFAULT NULL,
  asset_can_modify TINYINT(1) DEFAULT 1,
  asset_can_delete TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default super admin
INSERT IGNORE INTO users (username, email, password_hash, profile_type)
VALUES ('admin', 'admin@example.com', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'super_admin');
-- default password is: password
