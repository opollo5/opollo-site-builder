-- Rollback for 0109_image_library_hybrid_search.sql

DROP FUNCTION IF EXISTS public.hybrid_search_images(text, extensions.vector, int, uuid[], int);
