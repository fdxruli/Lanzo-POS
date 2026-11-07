-- MODIFICA PRODUCTION: anula una invitación NO consumida de esta licencia.
-- No elimina propietarios, sesiones ni dispositivos. Ejecutar como postgres.
SELECT private.revoke_license_onboarding_invitation(
  'COLOCA_LICENCIA_AQUI'
) AS resultado;
-- Esperado: success=true; revoked=true si existía una invitación pendiente.
-- Si cliente ya inscribió su propietario, no usar esto como recuperación de cuenta.
