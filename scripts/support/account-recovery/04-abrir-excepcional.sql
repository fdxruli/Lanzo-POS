-- Requiere v2. SOLO tras contrastar 2 fuentes independientes reales.
-- Los false son deliberados: no cambiarlos sin la comprobación humana indicada.
-- Elegir tipos según el manual. No inventar pagos/contratos que no existan.
-- No abre caso si falta la identidad original; no crea otro propietario.
select private.support_open_recovery_case(
  p_license_id => 'UUID_LICENCIA'::uuid,
  p_new_email => 'NUEVO_CORREO',
  p_operator => 'OPERADOR_QUE_COMPROBO_LAS_FUENTES',
  p_reason_reference => 'REFERENCIA_INTERNA_SOLICITUD_Y_MOTIVO',
  p_evidence => '[
    {"kind":"provider_payment","reference":"REFERENCIA_AL_COMPROBANTE_ORIGINAL","checked_against":"REGISTRO_DEL_COBRO_CONTRASTADO_POR_LANZO","independently_checked":false},
    {"kind":"prior_contract","reference":"REFERENCIA_AL_CONTRATO_HISTORICO","checked_against":"ARCHIVO_ORIGINAL_PREEXISTENTE_DE_LANZO","independently_checked":false}
  ]'::jsonb
);
