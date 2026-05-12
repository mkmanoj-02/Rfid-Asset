CREATE DATABASE IF NOT EXISTS asset_management;
USE asset_management;

CREATE TABLE IF NOT EXISTS locations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS asset_types (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rfid_tag VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  asset_type_id INT,
  current_location_id INT,
  status ENUM('active', 'inactive', 'maintenance') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (asset_type_id) REFERENCES asset_types(id) ON DELETE SET NULL,
  FOREIGN KEY (current_location_id) REFERENCES locations(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS movement_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  asset_id INT NOT NULL,
  from_location_id INT,
  to_location_id INT NOT NULL,
  moved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  FOREIGN KEY (from_location_id) REFERENCES locations(id) ON DELETE SET NULL,
  FOREIGN KEY (to_location_id) REFERENCES locations(id) ON DELETE CASCADE
);
