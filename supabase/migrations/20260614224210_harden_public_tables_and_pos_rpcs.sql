-- 1) Cerrar acceso directo a tablas y secuencias desde clientes públicos
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;

-- 2) Activar RLS en todas las tablas públicas del sistema de licencias
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.license_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.license_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.license_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.license_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;

-- 3) Cerrar ejecución pública de todas las funciones del schema public
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;

-- 4) Reabrir únicamente las RPC que usa el punto de venta
GRANT EXECUTE ON FUNCTION public.activate_license_on_device(text, text, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_device_license_unified(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_business_profile_anon(text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_business_profile_anon(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_license_devices_anon(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_device_anon(uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_free_trial_license(text, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_legal_terms(public.legal_doc_type) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_term_acceptance(text, uuid, text, jsonb) TO anon, authenticated;;
