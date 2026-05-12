USE asset_management;

-- Rules table
CREATE TABLE IF NOT EXISTS rules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  filter_type ENUM('asset','inventory','attribute','maintenance') NOT NULL,
  -- Common filters
  location_id INT,
  include_sub_locations TINYINT(1) DEFAULT 0,
  asset_type_id INT,
  -- Asset filter specific
  asset_action ENUM('enters','exits','stays_at','not_scanned','is_missing','is_added','is_deleted'),
  -- Duration (for stays_at, not_scanned, is_missing)
  duration_value INT,
  duration_unit ENUM('minutes','hours','days','weeks','months','years'),
  duration_condition ENUM('more_than','less_than'),
  -- Inventory filter
  inventory_condition ENUM('equal_to','greater_than','less_than'),
  inventory_value INT,
  -- Attribute filter
  attribute_id INT,
  attribute_condition ENUM('is','changed','greater_than','less_than','equal_to','before','after'),
  attribute_value VARCHAR(255),
  -- Maintenance filter
  maintenance_alert_value INT,
  maintenance_alert_unit ENUM('minutes','hours','days','weeks','months','years'),
  maintenance_condition ENUM('before','after'),
  -- Actions
  action_type ENUM('system_alert','email_alert','both') DEFAULT 'system_alert',
  action_email VARCHAR(255),
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL,
  FOREIGN KEY (asset_type_id) REFERENCES asset_types(id) ON DELETE SET NULL
);

-- Alerts table
CREATE TABLE IF NOT EXISTS alerts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rule_id INT,
  rule_name VARCHAR(255),
  filter_type ENUM('asset','inventory','attribute','maintenance') NOT NULL,
  alert_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  description TEXT,
  asset_id INT,
  asset_serial VARCHAR(255),
  asset_type VARCHAR(255),
  last_known_location VARCHAR(255),
  last_seen_time TIMESTAMP NULL,
  is_read TINYINT(1) DEFAULT 0,
  FOREIGN KEY (rule_id) REFERENCES rules(id) ON DELETE SET NULL,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL
);
