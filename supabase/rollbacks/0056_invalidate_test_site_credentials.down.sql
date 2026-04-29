-- Rollback for 0056_invalidate_test_site_credentials.sql.
--
-- Effectively unrecoverable: the forward migration deleted the
-- encrypted credential bytes. This rollback restores the column
-- comment but cannot bring the credentials back. The down-migration
-- exists for migration-tooling completeness; operators rolling back
-- will need to re-pair every site from scratch regardless.

COMMENT ON COLUMN sites.status IS NULL;
