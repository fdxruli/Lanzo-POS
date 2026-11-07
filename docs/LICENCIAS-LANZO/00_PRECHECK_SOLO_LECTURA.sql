-- SOLO LECTURA. Abrir en Supabase SQL Editor del proyecto odlrhijtfyavryeqivaa.
-- Confirmar que el rol sea postgres, que exista el plan Free y que onboarding esté instalado.
SELECT
  current_user AS rol_actual,
  current_database() AS base,
  (SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 1) AS ultima_migracion,
  EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20261107152500'
  ) AS onboarding_instalado,
  to_regprocedure('private.issue_license_onboarding_invitation(text)') IS NOT NULL AS emision_instalada,
  has_function_privilege('postgres', 'private.issue_license_onboarding_invitation(text)', 'EXECUTE') AS postgres_puede_emitir;

SELECT code, name, is_active, max_devices, price, currency
FROM public.plans
WHERE code = 'free_trial';
-- Esperado: rol postgres, onboarding true, plan free_trial / Lanzo Local activo / 1 dispositivo.
-- Si algo difiere, NO ejecutar 01 ni 02.
