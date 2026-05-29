-- 0160: add image_generation_failed to the platform_notification_type enum.
--
-- Required by A6 (regenerate loop + escalation email). The handler.ts
-- escalateToHuman() now calls dispatch("image_generation_failed") instead
-- of logger.error(). This migration extends the enum in the DB to allow
-- the INSERT to platform_notifications.type = 'image_generation_failed'.
--
-- Enum values are append-only in PostgreSQL; cannot be rolled back without
-- dropping the enum. Rollback stub is intentionally a no-op.

ALTER TYPE platform_notification_type ADD VALUE IF NOT EXISTS 'image_generation_failed';
