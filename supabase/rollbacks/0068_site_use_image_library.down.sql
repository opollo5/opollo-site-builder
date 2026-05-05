-- Rollback for 0068_site_use_image_library.sql
ALTER TABLE sites DROP COLUMN IF EXISTS use_image_library;
