-- Cerrar ejecución por herencia global PUBLIC
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;

-- Evitar que nuevas funciones queden ejecutables por PUBLIC automáticamente
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM authenticated;

-- Reabrir únicamente las RPC usadas por el punto de venta
GRANT EXECUTE ON FUNCTION public.activate_license_on_device(text, text, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_device_license_unified(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_business_profile_anon(text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_business_profile_anon(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_license_devices_anon(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_device_anon(uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_free_trial_license(text, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_legal_terms(public.legal_doc_type) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_term_acceptance(text, uuid, text, jsonb) TO anon, authenticated;;
