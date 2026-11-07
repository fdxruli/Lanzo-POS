-- Requiere v2. Ejecutar UNA acción cada vez y comprobar success=true e historial.
-- approve: segundo revisor distinto del creador; revisión real de las fuentes.
-- notice: referencia al aviso intentado al correo anterior y resultado real.
-- verify_new / verify_old: código devuelto por el buzón indicado; no el de password.
-- complete: comprueba aprobación, correo, aviso, espera y sesión si corresponde.
-- block: congela recuperación y revoca sesiones Admin ante disputa; no cambia correo.
-- cancel: termina el caso e invalida códigos pendientes; NO restaura sesiones.
-- No incluir contraseña ni tokens; p_code=null salvo verify_new / verify_old.
select private.support_recovery_case_action(
  p_case_id => 'UUID_CASO'::uuid,
  p_action => 'ACCION',
  p_operator => 'OPERADOR_IDENTIFICABLE',
  p_reference => 'REFERENCIA_INTERNA_DE_LA_ACCION_Y_RESULTADO',
  p_code => null
);
