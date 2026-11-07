-- SOLO SQL administrativo, requiere v2. Confirmar cuenta e incidente antes.
-- Congela recuperación, invalida códigos y revoca sesiones Admin. NO da acceso,
-- NO cambia contacto/contraseña, NO crea propietario. Puede interrumpir acceso.
-- Devuelve case_id: consultar 07. Resolver revisión antes de 06 cancel.
-- El security_hold no puede aprobarse ni completar recuperación: para ello
-- cancelar justificadamente y abrir un caso excepcional con evidencia real.
select private.support_block_admin_recovery(
  p_license_id => 'UUID_LICENCIA'::uuid,
  p_operator => 'OPERADOR_IDENTIFICABLE',
  p_reference => 'REFERENCIA_INTERNA_HECHOS_DE_LA_SOSPECHA_Y_REVISION'
);
