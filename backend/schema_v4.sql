USE asset_management;

-- Add default_value to asset type attributes
ALTER TABLE asset_type_attributes ADD COLUMN default_value TEXT DEFAULT NULL AFTER attr_type;
