-- MODIFICA PRODUCTION: emitir el código SOLO cuando el cliente vaya a configurarse.
-- SQL Editor como postgres. Código de 64 hex / un uso / 24 horas.
-- REEMPLAZA cualquier invitación pendiente de esta licencia; no repetir por simple consulta.
-- Entregar el resultado por canal seguro, nunca guardarlo en logs/capturas/commits.
SELECT private.issue_license_onboarding_invitation(
  'COLOCA_LICENCIA_AQUI'
) AS resultado;
-- Esperado: success=true, invitation_code, expires_at, invitation_id.
-- Si success=false, no intentar crear propietario desde SQL; investigar estado con 03.
