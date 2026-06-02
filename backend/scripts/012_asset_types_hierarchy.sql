USE asset_management;

-- Add parent_id to asset_types for hierarchy
ALTER TABLE asset_types ADD COLUMN parent_id INT DEFAULT NULL;
ALTER TABLE asset_types ADD CONSTRAINT fk_asset_type_parent FOREIGN KEY (parent_id) REFERENCES asset_types(id) ON DELETE SET NULL;
