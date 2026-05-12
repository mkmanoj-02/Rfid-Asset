USE asset_management;

ALTER TABLE assets 
  ADD COLUMN asset_serial VARCHAR(255) UNIQUE AFTER id,
  ADD COLUMN description TEXT AFTER status;

-- Insert a default location if not exists
INSERT IGNORE INTO locations (id, name, description) VALUES (1, 'Default', 'Default location for unassigned assets');
