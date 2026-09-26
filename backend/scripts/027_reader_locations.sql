CREATE TABLE IF NOT EXISTS reader_locations (
  id          INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_reader_locations_name (name)
);

INSERT IGNORE INTO reader_locations (name) VALUES
  ('Receiving dock'),
  ('North gate'),
  ('Aisle 4'),
  ('Cold storage'),
  ('Warehouse dock'),
  ('Stock room'),
  ('Yard lane');
