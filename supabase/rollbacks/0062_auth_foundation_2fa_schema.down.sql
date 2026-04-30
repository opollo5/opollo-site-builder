-- Rollback for 0062_auth_foundation_2fa_schema.sql.
-- Drops both 2FA tables. Any in-flight challenges + trusted-device
-- registrations are lost; users will be challenged again on next
-- login (when AUTH_2FA_ENABLED is re-enabled).

DROP TABLE IF EXISTS trusted_devices;
DROP TABLE IF EXISTS login_challenges;
