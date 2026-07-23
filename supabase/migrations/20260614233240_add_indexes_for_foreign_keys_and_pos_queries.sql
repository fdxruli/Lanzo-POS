-- Índices de rendimiento para Lanzo POS.
-- Objetivo principal: cubrir llaves foráneas marcadas por Supabase Advisor.
-- Objetivo secundario: optimizar consultas frecuentes de licencias, dispositivos, términos, logs y eventos.

-- =========================================================
-- 1) Índices para foreign keys sin índice
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_business_profiles_user_id
ON public.business_profiles USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_legal_acceptances_term_id
ON public.legal_acceptances USING btree (term_id);

CREATE INDEX IF NOT EXISTS idx_license_audit_log_license_id
ON public.license_audit_log USING btree (license_id);

CREATE INDEX IF NOT EXISTS idx_license_devices_user_id
ON public.license_devices USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_license_usage_logs_license_id
ON public.license_usage_logs USING btree (license_id);

CREATE INDEX IF NOT EXISTS idx_license_usage_logs_user_id
ON public.license_usage_logs USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_licenses_plan_id
ON public.licenses USING btree (plan_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_license_id
ON public.subscriptions USING btree (license_id);

-- =========================================================
-- 2) Índices compuestos útiles para las RPC y el POS
-- =========================================================

-- register_term_acceptance revisa si una licencia ya aceptó un término específico.
CREATE INDEX IF NOT EXISTS idx_legal_acceptances_license_id_term_id
ON public.legal_acceptances USING btree (license_id, term_id);

-- Consultas típicas por licencia y dispositivos activos.
-- La tabla ya tiene UNIQUE (license_id, device_fingerprint), pero este índice parcial ayuda
-- cuando se cuentan/listan solo dispositivos activos.
CREATE INDEX IF NOT EXISTS idx_license_devices_active_by_license
ON public.license_devices USING btree (license_id)
WHERE is_active = true;

-- Consultas/listados por licencia ordenados por último uso.
CREATE INDEX IF NOT EXISTS idx_license_devices_license_last_used
ON public.license_devices USING btree (license_id, last_used_at DESC);

-- Logs por licencia, ordenados por fecha más reciente.
CREATE INDEX IF NOT EXISTS idx_license_usage_logs_license_timestamp
ON public.license_usage_logs USING btree (license_id, "timestamp" DESC);

-- Eventos por licencia, ordenados por fecha más reciente.
CREATE INDEX IF NOT EXISTS idx_license_events_license_key_triggered_at
ON public.license_events USING btree (license_key, triggered_at DESC);

-- Limpieza de eventos antiguos por triggered_at.
CREATE INDEX IF NOT EXISTS idx_license_events_triggered_at
ON public.license_events USING btree (triggered_at);

-- Futuro panel/admin: filtros comunes por estado y expiración.
CREATE INDEX IF NOT EXISTS idx_licenses_status_expires_at
ON public.licenses USING btree (status, expires_at);;
