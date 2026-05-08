-- 0113: storage bucket for social composer direct uploads.
--
-- Separate from "generated-images" (AI generation pipeline) so size
-- limits and mime-type allow-lists don't collide. Service-role API
-- routes bypass RLS; the policy below covers future direct-client
-- upload paths.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'social-media',
  'social-media',
  false,
  10485760,  -- 10 MB
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Editors+ in a company may read/write their own company folder.
-- Path convention: {company_id}/{uuid}.{ext}
CREATE POLICY social_media_company_editor
  ON storage.objects FOR ALL
  TO authenticated
  USING (
    bucket_id = 'social-media'
    AND EXISTS (
      SELECT 1
      FROM platform_company_users pcu
      WHERE pcu.user_id = auth.uid()
        AND pcu.company_id = (storage.foldername(name))[1]::uuid
        AND pcu.role IN ('editor', 'approver', 'admin', 'super_admin')
    )
  )
  WITH CHECK (
    bucket_id = 'social-media'
    AND EXISTS (
      SELECT 1
      FROM platform_company_users pcu
      WHERE pcu.user_id = auth.uid()
        AND pcu.company_id = (storage.foldername(name))[1]::uuid
        AND pcu.role IN ('editor', 'approver', 'admin', 'super_admin')
    )
  );
