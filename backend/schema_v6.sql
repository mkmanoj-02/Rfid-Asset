USE asset_management;

-- Remove old users and set up administrator with password 'admin'
DELETE FROM users WHERE username IN ('admin', 'administrator');
INSERT INTO users (username, email, password_hash, profile_type)
VALUES ('administrator', 'admin@example.com', '$2b$10$3hl/OsQEMEzK3jbmY9BJy.pyMQU5xPirxSPREJw90YWuaZNG3nv7', 'super_admin');
