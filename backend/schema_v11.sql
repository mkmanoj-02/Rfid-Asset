USE asset_management;

CREATE TABLE IF NOT EXISTS location_types (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT IGNORE INTO location_types (name) VALUES ('Default'), ('Campus'), ('Building'), ('Floor'), ('Room'), ('Zone');

-- Add location_type_id column (ignore error if already exists)
ALTER TABLE locations ADD COLUMN location_type_id INT DEFAULT NULL;

-- Add foreign key (ignore error if already exists)
ALTER TABLE locations ADD CONSTRAINT fk_location_type FOREIGN KEY (location_type_id) REFERENCES location_types(id) ON DELETE SET NULL;
