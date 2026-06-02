-- Initial placement / import rows may set only from_location_id (to_location_id NULL)

ALTER TABLE movement_history MODIFY COLUMN to_location_id INT NULL;
