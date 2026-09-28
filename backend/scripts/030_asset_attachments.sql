-- One attachment per asset (file under uploads/attachments/)
ALTER TABLE assets ADD COLUMN attachment_url VARCHAR(500) DEFAULT NULL AFTER is_custom_image;
ALTER TABLE assets ADD COLUMN attachment_name VARCHAR(255) DEFAULT NULL AFTER attachment_url;
