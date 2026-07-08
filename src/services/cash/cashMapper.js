export const CASH_SYNC_STATUS = Object.freeze({
  LOCAL: 'local',
  SYNCED: 'synced',
  PENDING: 'pending',
  CONFLICT: 'conflict',
  READONLY_CACHE: 'readonly_cache'
});

const nowIso = () => new Date().toISOString();

const asStringAmount = (value, fallback = '0') => {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
};

const normalizeStatus = (status) => {
  if (status === 'open') return 'abierta';
  if (status === 'closed') return 'cerrada';
  if (status === 'cancelled') return 'cancelada';
  return status || 'abierta';
};

export const cloudCashSessionToLocal = (session = {}, existing = null) => {
  if (!session?.id) return null;

  const syncedAt = nowIso();
  const local = {
    ...(existing || {}),
    id: session.id,
    cash_session_id: session.id,
    fecha_apertura: session.opened_at || existing?.fecha_apertura || syncedAt,
    fecha_cierre: session.closed_at || null,
    monto_inicial: asStringAmount(session.opening_amount),
    monto_conteo_inicial: asStringAmount(session.opening_counted_amount, asStringAmount(session.opening_amount)),
    monto_fondo_sugerido: asStringAmount(session.opening_suggested_amount),
    diferencia_apertura: asStringAmount(session.opening_difference),
    politica_apertura: null,
    apertura_origen: session.opening_origin || null,
    es_auto_apertura: false,
    estado: normalizeStatus(session.status),
    monto_cierre: session.closing_counted_amount === null || session.closing_counted_amount === undefined
      ? null
      : asStringAmount(session.closing_counted_amount),
    monto_fondo_siguiente_turno: session.next_shift_fund === null || session.next_shift_fund === undefined
      ? null
      : asStringAmount(session.next_shift_fund),
    ventas_efectivo: asStringAmount(session.cash_sales_total),
    abonos_fiado: asStringAmount(session.customer_payments_total),
    entradas_efectivo: asStringAmount(session.cash_entries_total),
    salidas_efectivo: asStringAmount(session.cash_exits_total),
    total_teorico_cloud: asStringAmount(session.expected_cash_total),
    diferencia: session.cash_difference === null || session.cash_difference === undefined
      ? null
      : asStringAmount(session.cash_difference),
    responsable_apertura: session.responsible_name || existing?.responsable_apertura || 'Responsable',
    responsibleName: session.responsible_name || existing?.responsibleName || 'Responsable',
    comentarios_auditoria: session.audit_comments || null,
    detalle_cierre: session.close_detail || {},
    metadata: session.metadata || {},
    updatedAt: session.updated_at || session.created_at || syncedAt,
    syncStatus: CASH_SYNC_STATUS.SYNCED,
    serverVersion: Number(session.server_version || existing?.serverVersion || 1),
    lastSyncedAt: syncedAt,
    cloudUpdatedAt: session.updated_at || session.created_at || syncedAt,
    actorKey: session.actor_key || null,
    staffUserId: session.staff_user_id || null,
    deviceId: session.device_id || null,
    deviceRole: session.device_role || null,
    scope: session.scope || 'actor',
    cloudCash: true,
    deletedAt: session.deleted_at || null
  };

  return local;
};

export const cloudCashMovementToLocal = (movement = {}, existing = null) => {
  if (!movement?.id) return null;

  const syncedAt = nowIso();
  return {
    ...(existing || {}),
    id: movement.id,
    caja_id: movement.cash_session_id,
    cash_session_id: movement.cash_session_id,
    tipo: movement.type,
    monto: asStringAmount(movement.amount),
    concepto: movement.concept || '',
    fecha: movement.created_at || syncedAt,
    actor: movement.actor_name || null,
    actorName: movement.actor_name || null,
    origen: movement.source || 'manual',
    referenceType: movement.reference_type || null,
    referenceId: movement.reference_id || null,
    metadata: movement.metadata || {},
    syncStatus: CASH_SYNC_STATUS.SYNCED,
    serverVersion: Number(movement.server_version || existing?.serverVersion || 1),
    lastSyncedAt: syncedAt,
    cloudUpdatedAt: movement.created_at || syncedAt,
    actorKey: movement.actor_key || null,
    staffUserId: movement.staff_user_id || null,
    deviceId: movement.device_id || null,
    cloudCash: true,
    deletedAt: movement.deleted_at || null
  };
};

export const localOpeningToCloudPayload = (openingData = {}) => ({
  opening_amount: asStringAmount(openingData.montoInicial ?? openingData.opening_amount),
  opening_counted_amount: asStringAmount(openingData.montoContado ?? openingData.opening_counted_amount),
  opening_suggested_amount: asStringAmount(openingData.montoSugerido ?? openingData.opening_suggested_amount),
  opening_difference: asStringAmount(openingData.diferenciaApertura ?? openingData.opening_difference),
  opening_origin: openingData.origen || openingData.opening_origin || 'manual',
  responsible_name: openingData.responsable || openingData.responsible_name || null,
  metadata: openingData.metadata || {}
});

export const localClosingToCloudPayload = ({ countedAmount, nextShiftFund, comments, metadata = {} } = {}) => ({
  closing_counted_amount: asStringAmount(countedAmount),
  next_shift_fund: asStringAmount(nextShiftFund),
  audit_comments: comments || '',
  metadata
});
