-- ---------------------------------------------------------------------------
-- 0099 — add title column to image_library + refresh search_tsv trigger.
--
-- title: a human-readable label derived from IPTC metadata or the
-- filename during extraction. Displayed as the primary label on the
-- list page (replacing "no caption yet") and as the main heading on
-- the detail page. Nullable — rows that haven't been re-extracted yet
-- have null until the cron or the Re-extract button runs.
-- ---------------------------------------------------------------------------

ALTER TABLE image_library ADD COLUMN IF NOT EXISTS title text;

-- Update the search trigger to include title at weight A so titled
-- images surface before untitled ones on free-text queries.
CREATE OR REPLACE FUNCTION image_library_search_tsv_refresh()
RETURNS trigger AS $$
BEGIN
  NEW.search_tsv :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(NEW.caption, '')), 'A')
    || setweight(to_tsvector('english', coalesce(array_to_string(NEW.tags, ' '), '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
