USE asset_management;

-- Allow NULL email (UNIQUE still applies to non-null values in MySQL)
ALTER TABLE users MODIFY COLUMN email VARCHAR(255) DEFAULT NULL;
