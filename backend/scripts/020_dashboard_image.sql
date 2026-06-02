-- Per-user dashboard map background image (file under uploads/dashboardimage/)
USE asset;

ALTER TABLE users
  ADD COLUMN dashboard_image_url VARCHAR(512) DEFAULT NULL
  COMMENT 'Public path e.g. /uploads/dashboardimage/filename.png'
  AFTER asset_can_delete; 
