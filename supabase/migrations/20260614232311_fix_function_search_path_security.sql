-- Endurecer funciones marcadas por function_search_path_mutable.
-- Objetivo: que las funciones SECURITY DEFINER no dependan del search_path del usuario que las ejecuta.

-- 1) clean_old_events: antes usaba license_events sin schema explícito.
CREATE OR REPLACE FUNCTION public.clean_old_events()
RETURNS void
LANGUAGE sql
SET search_path = ''
AS $function$
    DELETE FROM public.license_events
    WHERE triggered_at < now() - INTERVAL '1 hour';
$function$;

-- 2) get_active_legal_terms: ya usaba public.legal_terms, ahora fija search_path.
CREATE OR REPLACE FUNCTION public.get_active_legal_terms(
    doc_type_param public.legal_doc_type DEFAULT 'terms_of_use'::public.legal_doc_type
)
RETURNS TABLE(
    id uuid,
    version text,
    content_html text,
    published_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    RETURN QUERY
    SELECT t.id, t.version, t.content_html, t.published_at
    FROM public.legal_terms t
    WHERE t.type = doc_type_param
      AND t.is_active = true
    ORDER BY t.published_at DESC
    LIMIT 1;
END;
$function$;

-- 3) notify_device_change: antes usaba licenses y license_events sin schema explícito.
CREATE OR REPLACE FUNCTION public.notify_device_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_license_key text;
BEGIN
    SELECT l.license_key
    INTO v_license_key
    FROM public.licenses l
    WHERE l.id = COALESCE(NEW.license_id, OLD.license_id);

    IF (TG_OP = 'UPDATE' AND OLD.is_active = true AND NEW.is_active = false) THEN
        INSERT INTO public.license_events (license_key, event_type, metadata)
        VALUES (
            v_license_key,
            'DEVICE_BANNED',
            jsonb_build_object('fingerprint', NEW.device_fingerprint)
        );
    END IF;

    IF (TG_OP = 'DELETE') THEN
        INSERT INTO public.license_events (license_key, event_type, metadata)
        VALUES (
            v_license_key,
            'DEVICE_DELETED',
            jsonb_build_object('fingerprint', OLD.device_fingerprint)
        );
    END IF;

    RETURN NULL;
END;
$function$;

-- 4) notify_license_change: antes usaba license_events sin schema explícito.
CREATE OR REPLACE FUNCTION public.notify_license_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    IF (OLD.status IS DISTINCT FROM NEW.status)
       OR (OLD.expires_at IS DISTINCT FROM NEW.expires_at)
       OR (OLD.features IS DISTINCT FROM NEW.features) THEN

        INSERT INTO public.license_events (license_key, event_type, metadata)
        VALUES (
            NEW.license_key,
            'LICENSE_UPDATE',
            jsonb_build_object('status', NEW.status)
        );
    END IF;

    RETURN NEW;
END;
$function$;

-- 5) register_term_acceptance: ya usaba public.tabla, ahora fija search_path.
CREATE OR REPLACE FUNCTION public.register_term_acceptance(
    p_license_key text,
    p_term_id uuid,
    p_device_fingerprint text,
    p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_license_id uuid;
    v_already_accepted boolean;
BEGIN
    SELECT l.id
    INTO v_license_id
    FROM public.licenses l
    WHERE l.license_key = p_license_key;

    IF v_license_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'LICENSE_NOT_FOUND');
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.legal_acceptances la
        WHERE la.license_id = v_license_id
          AND la.term_id = p_term_id
    )
    INTO v_already_accepted;

    IF v_already_accepted THEN
        RETURN jsonb_build_object('success', true, 'message', 'ALREADY_ACCEPTED');
    END IF;

    INSERT INTO public.legal_acceptances (
        license_id,
        term_id,
        device_fingerprint,
        accepted_at,
        metadata
    )
    VALUES (
        v_license_id,
        p_term_id,
        p_device_fingerprint,
        now(),
        p_metadata
    );

    RETURN jsonb_build_object('success', true);

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- Reafirmar permisos públicos únicamente para RPC que el POS necesita.
-- CREATE OR REPLACE normalmente conserva permisos, pero lo reafirmamos por claridad.
GRANT EXECUTE ON FUNCTION public.get_active_legal_terms(public.legal_doc_type) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_term_acceptance(text, uuid, text, jsonb) TO anon, authenticated;

-- Estas funciones son internas por trigger/limpieza, no se reabren a anon/authenticated:
-- public.notify_device_change()
-- public.notify_license_change()
-- public.clean_old_events();
