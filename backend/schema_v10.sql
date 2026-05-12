USE asset_management;

CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  type ENUM('Login','Login Failure','Asset','Asset Type','Location','User','Import','Rule','Alert') NOT NULL,
  action VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  username VARCHAR(255),
  user_id INT,
  logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_logged_at (logged_at),
  INDEX idx_username (username)
);
