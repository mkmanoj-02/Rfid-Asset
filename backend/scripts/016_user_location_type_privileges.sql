-- User privileges for location types (Settings → Users)

ALTER TABLE users ADD COLUMN location_type_privileges TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN location_type_can_modify TINYINT(1) DEFAULT 1;
ALTER TABLE users ADD COLUMN location_type_can_delete TINYINT(1) DEFAULT 1;
