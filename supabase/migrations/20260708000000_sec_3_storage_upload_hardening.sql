-- FASE SEC.3 — Hardening de Storage / Uploads del bucket images.
-- Cierra escritura directa amplia en storage.objects para images y agrega auditoría mínima.
-- No guarda license_key, security_token, staff_session_token, passwords ni secretos planos.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS public.storage_upload_audit (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  license_key_hash text NOT NULL,
  device_fingerprint_hash text,
  staff_session_hash text,
  purpose text NOT NULL,
  bucket_id text NOT NULL,
  object_path text NOT NULL,
  mime_type text,
  size_bytes bigint,
  status text NOT NULL,
  code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT storage_upload_audit_license_hash_format
    CHECK (license_key_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT storage_upload_audit_device_hash_format
    CHECK (device_fingerprint_hash IS NULL OR device_fingerprint_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT storage_upload_audit_staff_hash_format
    CHECK (staff_session_hash IS NULL OR staff_session_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT storage_upload_audit_bucket_images
    CHECK (bucket_id = 'images'),
  CONSTRAINT storage_upload_audit_status_allowed
    CHECK (status IN ('authorized', 'rejected', 'rate_limited', 'error')),
  CONSTRAINT storage_upload_audit_size_non_negative
    CHECK (size_bytes IS NULL OR size_bytes >= 0)
);

ALTER TABLE public.storage_upload_audit ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_storage_upload_audit_license_created
ON public.storage_upload_audit (license_key_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_storage_upload_audit_status_created
ON public.storage_upload_audit (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_storage_upload_audit_object_path
ON public.storage_upload_audit (object_path);

REVOKE ALL ON TABLE public.storage_upload_audit FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.storage_upload_audit_id_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.storage_upload_audit TO service_role;

COMMENT ON TABLE public.storage_upload_audit IS
  'SEC.3: auditoría mínima de autorizaciones de upload Storage. Identificadores sensibles se guardan como SHA-256; no guardar tokens ni license_key plano.';
COMMENT ON COLUMN public.storage_upload_audit.license_key_hash IS 'SHA-256 de license_key. Nunca guardar license_key plano.';
COMMENT ON COLUMN public.storage_upload_audit.device_fingerprint_hash IS 'SHA-256 de device_fingerprint cuando está disponible.';
COMMENT ON COLUMN public.storage_upload_audit.staff_session_hash IS 'SHA-256 de staff_session_token cuando está disponible. Nunca guardar token plano.';
COMMENT ON COLUMN public.storage_upload_audit.object_path IS 'Ruta Storage autorizada/generada para bucket images.';
COMMENT ON COLUMN public.storage_upload_audit.metadata IS 'Metadata defensiva no sensible. No guardar secretos ni datos personales innecesarios.';

CREATE OR REPLACE FUNCTION private.sec3_storage_image_allowed_purpose(p_purpose text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT lower(coalesce(p_purpose, '')) = ANY (ARRAY[
    'business-logo',
    'business-cover',
    'product-image',
    'category-image',
    'restaurant-item-image',
    'profile-image',
    'misc'
  ]::text[]);
$$;

CREATE OR REPLACE FUNCTION private.sec3_storage_image_allowed_extension(p_ext text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT lower(coalesce(p_ext, '')) = ANY (ARRAY['jpg','jpeg','png','webp','gif']::text[]);
$$;

CREATE OR REPLACE FUNCTION private.sec3_storage_image_allowed_mime_type(p_mime_type text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT lower(coalesce(p_mime_type, '')) = ANY (ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
  ]::text[]);
$$;

CREATE OR REPLACE FUNCTION private.sec3_storage_image_max_size_bytes(p_purpose text)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE lower(coalesce(p_purpose, 'misc'))
    WHEN 'business-logo' THEN 2097152::bigint
    WHEN 'business-cover' THEN 5242880::bigint
    WHEN 'product-image' THEN 4194304::bigint
    WHEN 'category-image' THEN 4194304::bigint
    WHEN 'restaurant-item-image' THEN 4194304::bigint
    WHEN 'profile-image' THEN 2097152::bigint
    ELSE 4194304::bigint
  END;
$$;

CREATE OR REPLACE FUNCTION private.sec3_storage_image_path_is_canonical(p_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    coalesce(p_name, '') ~ ('^public_uploads/[a-f0-9]{64}/' ||
      '(business-logo|business-cover|product-image|category-image|restaurant-item-image|profile-image|misc)/' ||
      '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|gif)$')
    AND coalesce(p_name, '') NOT LIKE '%//%'
    AND coalesce(p_name, '') !~ '(^|/)\.\.(/|$)'
    AND coalesce(p_name, '') !~ '[[:space:][:cntrl:]\\]'
    AND position('%2f' in lower(coalesce(p_name, ''))) = 0
    AND position('%5c' in lower(coalesce(p_name, ''))) = 0
    AND position('%00' in lower(coalesce(p_name, ''))) = 0;
$$;

REVOKE ALL ON FUNCTION private.sec3_storage_image_allowed_purpose(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.sec3_storage_image_allowed_extension(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.sec3_storage_image_allowed_mime_type(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.sec3_storage_image_max_size_bytes(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.sec3_storage_image_path_is_canonical(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.sec3_storage_image_allowed_purpose(text) TO service_role;
GRANT EXECUTE ON FUNCTION private.sec3_storage_image_allowed_extension(text) TO service_role;
GRANT EXECUTE ON FUNCTION private.sec3_storage_image_allowed_mime_type(text) TO service_role;
GRANT EXECUTE ON FUNCTION private.sec3_storage_image_max_size_bytes(text) TO service_role;
GRANT EXECUTE ON FUNCTION private.sec3_storage_image_path_is_canonical(text) TO service_role;

COMMENT ON FUNCTION private.sec3_storage_image_path_is_canonical(text) IS
  'SEC.3: valida contrato public_uploads/{license_hash}/{purpose}/{uuid}.{ext}; helper interno, no ejecutable por roles cliente.';

DO $$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND (
        policyname ILIKE '%images%'
        OR policyname ILIKE '%public_uploads%'
        OR coalesce(qual, '') ILIKE '%images%'
        OR coalesce(with_check, '') ILIKE '%images%'
        OR coalesce(qual, '') ILIKE '%public_uploads%'
        OR coalesce(with_check, '') ILIKE '%public_uploads%'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', v_policy.policyname);
  END LOOP;
END;
$$;

-- Lectura pública compatible: mantiene visibles las URLs legacy ya existentes bajo public_uploads/.
-- No habilita lectura de rutas internas fuera de public_uploads/.
CREATE POLICY "SEC3 images public read public_uploads only"
ON storage.objects
FOR SELECT
TO public
USING (
  bucket_id = 'images'
  AND name LIKE 'public_uploads/%'
  AND name NOT LIKE '%//%'
  AND name !~ '(^|/)\.\.(/|$)'
  AND name !~ '[[:cntrl:]\\]'
  AND position('%2f' in lower(name)) = 0
  AND position('%5c' in lower(name)) = 0
  AND position('%00' in lower(name)) = 0
);

-- SEC.3 no crea policies INSERT/UPDATE/DELETE para roles cliente sobre images.
-- Los uploads nuevos deben ir por authorize-image-upload + signed upload URL generado server-side.
-- Borrado/reemplazo directo por cliente queda cerrado para images hasta implementar flujo seguro dedicado.

NOTIFY pgrst, 'reload schema';
