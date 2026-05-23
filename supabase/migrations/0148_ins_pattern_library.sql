-- Migration 0148: ins_pattern_library — anonymised cross-client patterns
-- Privacy guarantees enforced at the schema level.

CREATE TABLE ins_pattern_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type TEXT NOT NULL CHECK (
    pattern_type IN (
      'cross_segment_winning_pattern',
      'cross_segment_topic_lift',
      'cross_segment_format_pattern'
    )
  ),
  applies_to_platforms TEXT[] NOT NULL,
  pattern_data JSONB NOT NULL,
  sample_size_n_companies INTEGER NOT NULL CHECK (sample_size_n_companies >= 5),
  sample_size_n_posts INTEGER NOT NULL CHECK (sample_size_n_posts >= 100),
  confidence_score NUMERIC(4, 3) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1),
  mined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,

  -- Privacy: forbid raw post content in pattern_data
  CHECK (NOT (pattern_data ? 'content')),
  CHECK (NOT (pattern_data ? 'post_text')),
  CHECK (NOT (pattern_data ? 'raw_text'))
);

CREATE INDEX idx_ins_pattern_library_type_platform
  ON ins_pattern_library (pattern_type, expires_at, mined_at DESC);

ALTER TABLE ins_pattern_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY ins_pattern_library_read ON ins_pattern_library
  FOR SELECT USING (TRUE);

CREATE POLICY ins_pattern_library_staff_write ON ins_pattern_library
  FOR ALL
  USING (is_opollo_staff())
  WITH CHECK (is_opollo_staff());
