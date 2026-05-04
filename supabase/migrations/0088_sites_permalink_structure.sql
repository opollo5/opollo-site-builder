-- M: add wp_permalink_structure cache column to sites
-- Fetched once from WP settings API (GET /wp-json/wp/v2/settings →
-- permalink_structure) and stored so the blog composer can render a URL
-- preview without a live WP round-trip on every keystroke.
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS wp_permalink_structure text;
