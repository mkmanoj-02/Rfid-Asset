-- Asset type names must be unique globally (not per parent).
-- Renames duplicate rows (keeps lowest id) before adding the unique index.

UPDATE asset_types at
INNER JOIN (
  SELECT id,
    ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(name)) ORDER BY id) AS rn
  FROM asset_types
) ranked ON ranked.id = at.id AND ranked.rn > 1
SET at.name = CONCAT(TRIM(at.name), ' (dup-', at.id, ')');

DROP INDEX idx_asset_types_name ON asset_types;

ALTER TABLE asset_types
  ADD UNIQUE KEY uq_asset_types_name (name);
