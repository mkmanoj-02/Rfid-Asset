USE asset_2;

-- Handheld / mobile reader devices (selected in Android app header)
CREATE TABLE IF NOT EXISTS handheld_devices (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_handheld_device_name (name)
);

-- Map which asset attributes are visible per device (empty = show none until mapped)
CREATE TABLE IF NOT EXISTS handheld_device_attributes (
  device_id     INT NOT NULL,
  attribute_id  INT NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (device_id, attribute_id),
  CONSTRAINT fk_hda_device FOREIGN KEY (device_id) REFERENCES handheld_devices(id) ON DELETE CASCADE,
  CONSTRAINT fk_hda_attribute FOREIGN KEY (attribute_id) REFERENCES asset_type_attributes(id) ON DELETE CASCADE
);
