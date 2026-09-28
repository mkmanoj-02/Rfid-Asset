ALTER TABLE assets ADD COLUMN asset_code VARCHAR(100) NULL AFTER id;

UPDATE assets
SET asset_code = CONCAT('AST-', LPAD(id, 6, '0'))
WHERE asset_code IS NULL OR TRIM(asset_code) = '';

ALTER TABLE assets MODIFY asset_code VARCHAR(100) NOT NULL;

ALTER TABLE assets ADD UNIQUE KEY uq_assets_asset_code (asset_code);
