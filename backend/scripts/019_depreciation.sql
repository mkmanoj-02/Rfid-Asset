-- Depreciation module tables (run once if missing).
-- Per-asset purchase data: asset_financials (Financial tab on asset detail).
-- Per asset-type rules: depreciation_rules (Depreciation → Rules tab).

USE asset;

CREATE TABLE IF NOT EXISTS depreciation_rules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rule_code VARCHAR(32) NOT NULL,
  asset_type_id INT NOT NULL,
  method VARCHAR(64) NOT NULL DEFAULT 'SLM',
  useful_life_years DECIMAL(8,2) NOT NULL,
  depreciation_rate DECIMAL(10,4) NOT NULL,
  salvage_value DECIMAL(15,2) DEFAULT 0,
  effective_from DATE NOT NULL,
  stop_on_disposal TINYINT(1) DEFAULT 1,
  partial_year TINYINT(1) DEFAULT 0,
  is_active TINYINT(1) DEFAULT 1,
  created_by VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_rule_code (rule_code),
  FOREIGN KEY (asset_type_id) REFERENCES asset_types(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS asset_financials (
  id INT AUTO_INCREMENT PRIMARY KEY,
  asset_id INT NOT NULL,
  purchase_cost DECIMAL(15,2) NOT NULL DEFAULT 0,
  salvage_value DECIMAL(15,2) DEFAULT 0,
  purchase_date DATE DEFAULT NULL,
  current_book_value DECIMAL(15,2) DEFAULT NULL,
  total_depreciation DECIMAL(15,2) DEFAULT 0,
  last_depreciation_date DATE DEFAULT NULL,
  is_disposed TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_asset_financials_asset (asset_id),
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS depreciation_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  run_code VARCHAR(32) NOT NULL,
  run_date DATE NOT NULL,
  asset_type_id INT NOT NULL,
  asset_type_name VARCHAR(255) DEFAULT NULL,
  rule_id INT DEFAULT NULL,
  triggered_by VARCHAR(255) DEFAULT NULL,
  assets_processed INT DEFAULT 0,
  total_depreciation DECIMAL(15,2) DEFAULT 0,
  status VARCHAR(32) DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS depreciation_entries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  run_id INT NOT NULL,
  asset_id INT NOT NULL,
  asset_serial VARCHAR(255) DEFAULT NULL,
  asset_name VARCHAR(255) DEFAULT NULL,
  opening_value DECIMAL(15,2) DEFAULT NULL,
  depreciation_amount DECIMAL(15,2) DEFAULT NULL,
  closing_value DECIMAL(15,2) DEFAULT NULL,
  method VARCHAR(64) DEFAULT NULL,
  FOREIGN KEY (run_id) REFERENCES depreciation_history(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS depreciation_audit (
  id INT AUTO_INCREMENT PRIMARY KEY,
  action VARCHAR(255) NOT NULL,
  target VARCHAR(255) DEFAULT NULL,
  performed_by VARCHAR(255) DEFAULT NULL,
  details TEXT,
  logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
