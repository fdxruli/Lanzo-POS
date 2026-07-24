-- FASE 6H.7.4 — Rendimiento PRO en hora pico
-- Objetivo: reducir CPU y lecturas repetidas sin cambiar reglas de negocio.

CREATE OR REPLACE FUNCTION public.verify_staff_session(
  p_license_key text,
  p_device_fingerprint text,
  p_staff_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_license record;
  v_device record;
  v_session record;
BEGIN
  IF coalesce(p_staff_session_token, '') = '' THEN
    RETURN jsonb_build_object('success', false, 'valid', false, 'code', 'SESSION_NOT_FOUND', 'message', 'Sesion staff no valida.');
  END IF;

  SELECT l.id AS license_id,
         l.status AS license_status,
         l.expires_at AS license_expires_at
    INTO v_license
    FROM public.licenses l
   WHERE l.license_key = p_license_key
   LIMIT 1;

  IF v_license.license_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'valid', false, 'code', 'SESSION_NOT_FOUND', 'message', 'Sesion staff no valida.');
  END IF;

  IF v_license.license_status <> 'active'
     OR (v_license.license_expires_at IS NOT NULL AND v_license.license_expires_at < now()) THEN
    RETURN jsonb_build_object('success', false, 'valid', false, 'code', 'LICENSE_NOT_ACTIVE', 'message', 'Licencia no activa.');
  END IF;

  SELECT d.id AS device_id,
         d.is_active AS device_is_active
    INTO v_device
    FROM public.license_devices d
   WHERE d.license_id = v_license.license_id
     AND d.device_fingerprint = p_device_fingerprint
   LIMIT 1;

  IF v_device.device_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'valid', false, 'code', 'SESSION_NOT_FOUND', 'message', 'Sesion staff no valida.');
  END IF;

  IF coalesce(v_device.device_is_active, false) = false THEN
    RETURN jsonb_build_object('success', false, 'valid', false, 'code', 'DEVICE_NOT_ALLOWED', 'message', 'Dispositivo no permitido.');
  END IF;

  -- Evita ejecutar crypt() contra historiales completos de sesiones.
  -- staff_login_on_device revoca sesiones anteriores del mismo dispositivo;
  -- normalmente esta ventana trae 1 fila y como máximo 3 candidatas recientes.
  SELECT candidate.id AS session_id,
         candidate.expires_at,
         candidate.revoked_at,
         s.id AS staff_user_id,
         s.username,
         s.display_name,
         s.role_name,
         s.permissions,
         s.is_active AS staff_is_active
    INTO v_session
    FROM (
      SELECT ss.id,
             ss.staff_user_id,
             ss.session_token_hash,
             ss.expires_at,
             ss.revoked_at,
             ss.created_at
        FROM public.license_staff_sessions ss
       WHERE ss.license_id = v_license.license_id
         AND ss.device_id = v_device.device_id
         AND ss.revoked_at IS NULL
       ORDER BY ss.created_at DESC
       LIMIT 3
    ) candidate
    JOIN public.license_staff_users s ON s.id = candidate.staff_user_id
   WHERE s.license_id = v_license.license_id
     AND extensions.crypt(coalesce(p_staff_session_token, ''), candidate.session_token_hash) = candidate.session_token_hash
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'valid', false, 'code', 'SESSION_NOT_FOUND', 'message', 'Sesion staff no valida.');
  END IF;

  IF v_session.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'valid', false, 'code', 'SESSION_EXPIRED', 'message', 'Sesion staff expirada.');
  END IF;

  IF coalesce(v_session.staff_is_active, false) = false THEN
    RETURN jsonb_build_object('success', false, 'valid', false, 'code', 'STAFF_USER_INACTIVE', 'message', 'Usuario staff desactivado.');
  END IF;

  -- No bloquear verificaciones concurrentes solo por last_seen_at.
  PERFORM private.touch_license_staff_session_seen(v_session.session_id, '30 seconds'::interval);

  RETURN jsonb_build_object(
    'success', true,
    'valid', true,
    'staff_user', jsonb_build_object(
      'id', v_session.staff_user_id,
      'username', v_session.username,
      'display_name', v_session.display_name,
      'role_name', v_session.role_name,
      'permissions', v_session.permissions
    ),
    'expires_at', v_session.expires_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.pos_get_current_cash_session(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_context jsonb;
  v_license_id uuid;
  v_actor_key text;
  v_session public.pos_cash_sessions;
  v_movements jsonb := '[]'::jsonb;
  v_admin_open_sessions jsonb := '[]'::jsonb;
  v_should_recalculate boolean := false;
BEGIN
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  PERFORM private.assert_cloud_cash_sync_enabled(v_context);
  PERFORM private.assert_cash_permission(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);

  SELECT * INTO v_session
    FROM public.pos_cash_sessions s
   WHERE s.license_id = v_license_id
     AND s.actor_key = v_actor_key
     AND s.status = 'open'
     AND s.deleted_at IS NULL
   ORDER BY s.opened_at DESC
   LIMIT 1;

  IF v_session.id IS NOT NULL THEN
    v_should_recalculate := v_session.updated_at IS NULL
      OR v_session.updated_at < (now() - interval '30 seconds');

    -- Protección anti-dogpile: si muchos clientes consultan al mismo tiempo,
    -- solo uno recalcula; los demás reciben los totales almacenados recientes.
    IF v_should_recalculate
       AND pg_catalog.pg_try_advisory_xact_lock(
         pg_catalog.hashtext(v_license_id::text),
         pg_catalog.hashtext(v_session.id)
       ) THEN
      v_session := private.recalculate_pos_cash_session_totals(v_license_id, v_session.id, false);
    END IF;

    WITH limited_movement_ids AS (
      SELECT m.id
        FROM public.pos_cash_movements m
       WHERE m.license_id = v_license_id
         AND m.cash_session_id = v_session.id
         AND m.deleted_at IS NULL
       ORDER BY m.created_at DESC
       LIMIT 100
    )
    SELECT coalesce(jsonb_agg(private.pos_cash_movement_to_jsonb(m) ORDER BY m.created_at DESC), '[]'::jsonb)
      INTO v_movements
      FROM public.pos_cash_movements m
      JOIN limited_movement_ids lm ON lm.id = m.id;
  END IF;

  IF coalesce(v_context->>'device_role', 'staff') <> 'staff' THEN
    WITH limited_session_ids AS (
      SELECT s.id
        FROM public.pos_cash_sessions s
       WHERE s.license_id = v_license_id
         AND s.status = 'open'
         AND s.deleted_at IS NULL
       ORDER BY s.opened_at DESC
       LIMIT 100
    )
    SELECT coalesce(jsonb_agg(private.pos_cash_session_to_jsonb(s) ORDER BY s.opened_at DESC), '[]'::jsonb)
      INTO v_admin_open_sessions
      FROM public.pos_cash_sessions s
      JOIN limited_session_ids ls ON ls.id = s.id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'cash_session', CASE WHEN v_session.id IS NULL THEN NULL ELSE private.pos_cash_session_to_jsonb(v_session) END,
    'movements', v_movements,
    'admin_open_sessions', v_admin_open_sessions,
    'actor_key', v_actor_key,
    'actor_name', private.resolve_cash_actor_name(v_context),
    'sync_context', jsonb_build_object(
      'device_role', v_context->>'device_role',
      'staff_user_id', v_context->>'staff_user_id',
      'cloud_cash_sync', true
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.pos_pull_sync_events(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text DEFAULT NULL::text,
  p_since_change_seq bigint DEFAULT 0,
  p_limit integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_context jsonb;
  v_license_id uuid;
  v_limit integer;
  v_events jsonb;
  v_latest_returned bigint;
  v_server_latest bigint;
BEGIN
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);

  IF coalesce((v_context->'features'->>'cloud_pos_sync')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'CLOUD_POS_SYNC_DISABLED',
      'message', 'La sincronizacion cloud POS no esta habilitada para este plan.',
      'events', '[]'::jsonb,
      'latest_change_seq', coalesce(p_since_change_seq, 0),
      'server_latest_change_seq', coalesce(p_since_change_seq, 0),
      'has_more', false
    );
  END IF;

  v_license_id := (v_context->>'license_id')::uuid;
  v_limit := least(greatest(coalesce(p_limit, 500), 1), 1000);

  WITH pulled AS (
    SELECT e.id, e.entity_type, e.entity_id, e.operation, e.change_seq, e.server_version,
           e.actor_device_id, e.actor_staff_user_id, e.idempotency_key, e.metadata, e.created_at
      FROM public.pos_sync_events e
     WHERE e.license_id = v_license_id
       AND e.change_seq > coalesce(p_since_change_seq, 0)
     ORDER BY e.change_seq ASC
     LIMIT v_limit
  )
  SELECT coalesce(jsonb_agg(to_jsonb(pulled) ORDER BY pulled.change_seq ASC), '[]'::jsonb),
         coalesce(max(pulled.change_seq), coalesce(p_since_change_seq, 0))
    INTO v_events, v_latest_returned
    FROM pulled;

  SELECT e.change_seq
    INTO v_server_latest
    FROM public.pos_sync_events e
   WHERE e.license_id = v_license_id
   ORDER BY e.change_seq DESC
   LIMIT 1;

  v_server_latest := coalesce(v_server_latest, coalesce(p_since_change_seq, 0));

  RETURN jsonb_build_object(
    'success', true,
    'events', v_events,
    'latest_change_seq', v_latest_returned,
    'server_latest_change_seq', v_server_latest,
    'has_more', v_server_latest > v_latest_returned,
    'sync_context', jsonb_build_object(
      'device_role', v_context->>'device_role',
      'plan_code', v_context->>'plan_code',
      'cloud_pos_sync', coalesce((v_context->'features'->>'cloud_pos_sync')::boolean, false),
      'cloud_cash_sync', coalesce((v_context->'features'->>'cloud_cash_sync')::boolean, false)
    )
  );
END;
$function$;

COMMENT ON FUNCTION public.verify_staff_session(text, text, text)
  IS 'FASE 6H.7.4: prefiltra sesiones staff recientes antes de crypt() para reducir CPU en hora pico.';

COMMENT ON FUNCTION public.pos_get_current_cash_session(text, text, text, text)
  IS 'FASE 6H.7.4: evita recalcular totales en cada lectura; usa ventana de 30s y advisory lock anti-dogpile.';

COMMENT ON FUNCTION public.pos_pull_sync_events(text, text, text, text, bigint, integer)
  IS 'FASE 6H.7.4: usa lectura descendente indexada para server_latest_change_seq en lugar de MAX agregado repetido.';;
