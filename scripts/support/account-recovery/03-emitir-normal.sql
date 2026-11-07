-- v1: contraseña para contacto verificado. Entregar SOLO a delivery_email.
-- No ejecutar si hay indicios de correo comprometido; abrir revisión excepcional.
-- Para vinculación inicial: purpose='contact', request_id=UUID mostrado en LANZO.
-- Mantener request_id=NULL para contraseña. Respeta 60s / 3 por hora / 5 por día.
select private.support_issue_admin_recovery_code(
  p_license_id => 'UUID_LICENCIA'::uuid,
  p_purpose => 'password',
  p_operator => 'OPERADOR_IDENTIFICABLE',
  p_evidence_reference => 'REFERENCIA_INTERNA_Y_COMPROBACION_DEL_CONTACTO',
  p_request_id => null
);
