USE asset_management;

ALTER TABLE handheld_devices ADD COLUMN platform VARCHAR(40) DEFAULT NULL AFTER description;
