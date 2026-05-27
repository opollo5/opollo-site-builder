-- Migration 0155: V2 schema gaps for V1→V2 migration workstream.
--
-- social_post_drafts is missing two columns present on the V1 social_post_master
-- table that are needed to preserve data fidelity during the V1→V2 backfill:
--
--   link_url   — V1 stores link_url as a top-level column. V2 stores it inside
--                draft_data JSONB only (confirmed by calendar-view/route.ts:68
--                comment). The backfill script needs a real column to query and
--                index. The calendar-view route will be updated in a subsequent
--                PR (PR-03) to read this column directly.
--
--   source_type — V1 uses social_post_source ENUM ('manual','csv','cap','api').
--                 V2 has no equivalent — BSP analytics source-attribution
--                 (lib/insights/source-attribution.ts) traverses the V1 chain.
--                 Adding source_type to V2 lets the backfill record the origin
--                 of each migrated post and preserves attribution after V1 drop.
--
-- Both columns are nullable so they don't break existing V2 drafts (which were
-- created without these fields). The CHECK constraint mirrors V1's enum values
-- and adds no overhead on existing rows.
--
-- Rollback: DROP COLUMN link_url, DROP COLUMN source_type (safe — no data yet).

ALTER TABLE social_post_drafts
  ADD COLUMN IF NOT EXISTS link_url    TEXT,
  ADD COLUMN IF NOT EXISTS source_type TEXT CHECK (
    source_type IN ('manual', 'csv', 'cap', 'api')
  );
