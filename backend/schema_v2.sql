USE asset_management;

-- Add parent_id to locations for tree structure
ALTER TABLE locations ADD COLUMN parent_id INT DEFAULT NULL,
  ADD CONSTRAINT fk_location_parent FOREIGN KEY (parent_id) REFERENCES locations(id) ON DELETE CASCADE;

-- Asset type attributes
CREATE TABLE IF NOT EXISTS asset_type_attributes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  asset_type_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  attr_type ENUM('string','double','date','list') NOT NULL DEFAULT 'string',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (asset_type_id) REFERENCES asset_types(id) ON DELETE CASCADE
);

-- List options for attributes of type 'list'
CREATE TABLE IF NOT EXISTS attribute_list_options (
  id INT AUTO_INCREMENT PRIMARY KEY,
  attribute_id INT NOT NULL,
  option_value VARCHAR(255) NOT NULL,
  sort_order INT DEFAULT 0,
  FOREIGN KEY (attribute_id) REFERENCES asset_type_attributes(id) ON DELETE CASCADE
);

-- Asset attribute values
CREATE TABLE IF NOT EXISTS asset_attribute_values (
  id INT AUTO_INCREMENT PRIMARY KEY,
  asset_id INT NOT NULL,
  attribute_id INT NOT NULL,
  value TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_asset_attr (asset_id, attribute_id),
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  FOREIGN KEY (attribute_id) REFERENCES asset_type_attributes(id) ON DELETE CASCADE
);
