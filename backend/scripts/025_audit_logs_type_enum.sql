USE asset_management;

-- Expand audit_logs.type for Settings, Handheld, Logout, Dashboard
ALTER TABLE audit_logs
  MODIFY COLUMN type ENUM(
    'Login',
    'Login Failure',
    'Logout',
    'Asset',
    'Asset Type',
    'Location',
    'User',
    'Import',
    'Rule',
    'Alert',
    'Settings',
    'Handheld',
    'Dashboard'
  ) NOT NULL;
