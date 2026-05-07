-- Rollback for 0108_image_caption_embedding.sql
-- Drops the embedding column + HNSW index. Does NOT drop the vector
-- extension itself (other tables may eventually use it; dropping the
-- extension is reserved for an operator-driven step).

DROP INDEX IF EXISTS idx_image_library_caption_embedding_hnsw;
ALTER TABLE image_library DROP COLUMN IF EXISTS caption_embedding;
