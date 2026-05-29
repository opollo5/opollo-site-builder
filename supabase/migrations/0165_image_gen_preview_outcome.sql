-- 0165: B5 — add 'preview' value to image_gen_outcome enum.
--
-- §B5 of MASS_IMAGE_GEN_BUILD_BRIEF. Preview-mode jobs flow through the
-- canonical qstash handler but never call Ideogram. They write an
-- image_generation_log row with outcome='preview' so the operator can audit
-- exactly which prompts would have been sent without incurring spend.
--
-- ALTER TYPE ... ADD VALUE IF NOT EXISTS is PG13+ (already required by 0126
-- for social_error_class). Safe re-apply.

ALTER TYPE image_gen_outcome ADD VALUE IF NOT EXISTS 'preview';
