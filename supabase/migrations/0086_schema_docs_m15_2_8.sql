-- M15-2 #8 — Document event-table PK type inconsistency.
--
-- generation_events and regeneration_events use bigserial PKs (appended
-- in the original M3/M7 schemas for append-only log performance). transfer_events
-- uses uuid (M4 schema, different author convention). The mismatch is cosmetic
-- today — the three tables are never queried together. A future unified event
-- stream would need a migration to normalise them. Until then, this comment
-- surfaces the deviation for reviewers and M15-8 type generation.

COMMENT ON TABLE generation_events IS
  'Append-only event log for generation_jobs slots. PK is bigserial (not uuid) — '
  'this is intentional for append-performance in the original M3 schema. '
  'transfer_events uses uuid PKs; regeneration_events matches this bigserial convention. '
  'Normalise to uuid if a unified event stream is ever built (M15-2 #8).';

COMMENT ON TABLE regeneration_events IS
  'Append-only event log for regeneration_jobs. PK is bigserial (not uuid) — '
  'matches generation_events convention from M3, differs from transfer_events (uuid). '
  'Cosmetic inconsistency; normalise with generation_events if a unified event stream '
  'is ever built (M15-2 #8).';

COMMENT ON TABLE transfer_events IS
  'Append-only event log for transfer_jobs. PK is uuid (M4 schema convention), '
  'unlike generation_events and regeneration_events which use bigserial. '
  'Cosmetic inconsistency; normalise if a unified event stream is ever built (M15-2 #8).';
