-- Requiere v2. Excepcional: aprobar antes con 06; autenticado: comprobar solicitud.
-- target='new' para buzón nuevo; 'old' para confirmación del anterior.
-- Entregar únicamente a delivery_email; son códigos de cambio de contacto,
-- NO códigos de contraseña. Pedir devolverlos solo al canal oficial de soporte.
select private.support_issue_recovery_case_code(
  p_case_id => 'UUID_CASO'::uuid,
  p_target => 'new',
  p_operator => 'OPERADOR_IDENTIFICABLE',
  p_reference => 'REFERENCIA_INTERNA_VERIFICACION_Y_ENTREGA'
);
