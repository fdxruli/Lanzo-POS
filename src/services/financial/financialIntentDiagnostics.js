// This module is deliberately pure: no Dexie, runtime, cloud, or projection imports.
export const FINANCIAL_DIAGNOSTIC_PENDING_THRESHOLD_MS = 15 * 60 * 1000;
export const FINANCIAL_DIAGNOSTIC_DEFAULT_LIMIT = 50;
export const FINANCIAL_DIAGNOSTIC_MAX_LIMIT = 100;

export const FINANCIAL_DIAGNOSTIC_HEALTH = Object.freeze({
  HEALTHY: 'HEALTHY',
  PROJECTION_ATTENTION: 'PROJECTION_ATTENTION',
  PREPARED_NOT_DISPATCHED: 'PREPARED_NOT_DISPATCHED',
  RECEIPT_PENDING: 'RECEIPT_PENDING',
  RECEIPT_PENDING_PROLONGED: 'RECEIPT_PENDING_PROLONGED',
  CONFLICT: 'CONFLICT',
  BLOCKED: 'BLOCKED'
});

export const FINANCIAL_OPERATION_LABELS = Object.freeze({
  'cash.open': 'Apertura de caja',
  'cash.movement': 'Movimiento de caja',
  'cash.adjust_initial_fund': 'Ajuste de fondo inicial',
  'cash.close': 'Cierre de caja',
  'cash.admin_close': 'Cierre administrativo de caja',
  'sale.cashier': 'Venta de cajero',
  'sale.cashier_inventory': 'Venta de cajero con inventario',
  'sale.credit': 'Venta a crédito',
  'sale.cancel': 'Cancelación de venta'
});

const finiteDate = (value) => {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : null;
};

// A diagnostic fingerprint must never reconstruct a short fixture key either.
export const maskFinancialFingerprint = (value) => {
  if (typeof value !== 'string' || !value) return null;
  if (value.length <= 6) return '••••';
  if (value.length <= 16) return `${value.slice(0, 2)}…${value.slice(-2)}`;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
};

const derivedAge = (row, currentTime) => {
  const reference = finiteDate(row?.lastDispatchAt) || finiteDate(row?.createdAt);
  return reference === null ? null : Math.max(0, currentTime - reference);
};

export const classifyFinancialIntentHealth = (row, {
  currentTime = Date.now(),
  pendingThresholdMs = FINANCIAL_DIAGNOSTIC_PENDING_THRESHOLD_MS
} = {}) => {
  const status = String(row?.status || '').toUpperCase();
  const projectionStatus = String(row?.projectionStatus || '').toUpperCase();
  const ageMs = derivedAge(row, currentTime);
  const pendingIsProlonged = ageMs !== null && ageMs >= pendingThresholdMs;

  if (status === 'COMPLETED') {
    return [
      'PENDING',
      'FAILED'
    ].includes(projectionStatus)
      ? FINANCIAL_DIAGNOSTIC_HEALTH.PROJECTION_ATTENTION
      : FINANCIAL_DIAGNOSTIC_HEALTH.HEALTHY;
  }
  if (status === 'CONFLICT') return FINANCIAL_DIAGNOSTIC_HEALTH.CONFLICT;
  if (status === 'BLOCKED') return FINANCIAL_DIAGNOSTIC_HEALTH.BLOCKED;
  if (status === 'PREPARED' && Number(row?.dispatchAttemptCount || 0) === 0) {
    return FINANCIAL_DIAGNOSTIC_HEALTH.PREPARED_NOT_DISPATCHED;
  }
  if (['DISPATCHING', 'PENDING_RECEIPT', 'PREPARED'].includes(status)) {
    return pendingIsProlonged
      ? FINANCIAL_DIAGNOSTIC_HEALTH.RECEIPT_PENDING_PROLONGED
      : FINANCIAL_DIAGNOSTIC_HEALTH.RECEIPT_PENDING;
  }
  return FINANCIAL_DIAGNOSTIC_HEALTH.RECEIPT_PENDING;
};

const leaseState = (row, currentTime) => {
  if (!row?.recoveryLeaseId || !row?.recoveryLeaseUntil) return 'NONE';
  const expiresAt = finiteDate(row.recoveryLeaseUntil);
  return expiresAt !== null && expiresAt > currentTime ? 'ACTIVE' : 'EXPIRED';
};

const diagnosticCandidates = (row, recoveryLeaseState) => ({
  refreshReceipt: recoveryLeaseState !== 'ACTIVE' && !['CONFLICT', 'BLOCKED'].includes(String(row?.status || '').toUpperCase()),
  retryProjection: recoveryLeaseState !== 'ACTIVE'
    && String(row?.status || '').toUpperCase() === 'COMPLETED'
    && ['PENDING', 'FAILED'].includes(String(row?.projectionStatus || '').toUpperCase()),
  copyDiagnostic: true
});

/**
 * Converts one durable ledger row into the only DTO React/support may receive.
 * Request/response/canonical payloads are intentionally absent by construction.
 */
export const toFinancialIntentDiagnostic = (row, {
  currentTime = Date.now(),
  pendingThresholdMs = FINANCIAL_DIAGNOSTIC_PENDING_THRESHOLD_MS
} = {}) => {
  const ageMs = derivedAge(row, currentTime);
  const recoveryLeaseState = leaseState(row, currentTime);
  const healthStatus = classifyFinancialIntentHealth(row, { currentTime, pendingThresholdMs });
  const safe = {
    intentId: row?.id || null,
    ledgerVersion: Number(row?.ledgerVersion || 1),
    operationType: row?.operationType || null,
    operationLabel: FINANCIAL_OPERATION_LABELS[row?.operationType] || 'Operación financiera',
    idempotencyKeyFingerprint: maskFinancialFingerprint(row?.idempotencyKey),
    requestHashFingerprint: maskFinancialFingerprint(row?.requestHash),
    requestContractVersion: row?.requestContractVersion || null,
    financialStatus: row?.status || null,
    projectionStatus: row?.projectionStatus || null,
    dispatchAttemptCount: Number(row?.dispatchAttemptCount || 0),
    recoveryAttemptCount: Number(row?.recoveryAttemptCount || 0),
    firstDispatchAt: row?.firstDispatchAt || null,
    lastDispatchAt: row?.lastDispatchAt || null,
    lastRecoveryAt: row?.lastRecoveryAt || null,
    lastReceiptStatus: row?.lastReceiptStatus || null,
    lastProtocolCode: row?.lastProtocolCode || null,
    lastRecoveryCode: row?.lastRecoveryCode || null,
    projectionErrorCode: row?.projectionErrorCode || null,
    createdAt: row?.createdAt || null,
    updatedAt: row?.updatedAt || null,
    completedAt: row?.completedAt || null,
    originActorType: row?.originActorType || null,
    originActorKey: row?.originActorKey || null,
    cashSessionId: row?.cashSessionId || null,
    cashStationId: row?.cashStationId || null,
    hasDeviceProof: Boolean(row?.originDeviceRef),
    recoveryLeaseState,
    recoveryLeaseUntil: row?.recoveryLeaseUntil || null,
    ageMs,
    healthStatus,
    actionCandidates: diagnosticCandidates(row, recoveryLeaseState)
  };
  return Object.freeze(safe);
};

export const financialDiagnosticHealthPriority = (diagnostic) => ({
  BLOCKED: 0,
  CONFLICT: 1,
  PROJECTION_ATTENTION: 2,
  RECEIPT_PENDING_PROLONGED: 3,
  PREPARED_NOT_DISPATCHED: 4,
  RECEIPT_PENDING: 5,
  HEALTHY: 6
}[diagnostic?.healthStatus] ?? 7);

export const buildFinancialDiagnosticText = (diagnostic, {
  appVersion = null,
  tenantOpaqueId = null,
  viewerActorKey = null
} = {}) => [
  'LANZO — DIAGNÓSTICO FINANCIERO SANITIZADO',
  appVersion ? `Versión: ${appVersion}` : null,
  tenantOpaqueId ? `Tenant: ${tenantOpaqueId}` : null,
  viewerActorKey ? `Actor visualizador: ${viewerActorKey}` : null,
  `Intent: ${diagnostic?.intentId || 'No disponible'}`,
  `Operación: ${diagnostic?.operationLabel || diagnostic?.operationType || 'No disponible'}`,
  `Estado financiero: ${diagnostic?.financialStatus || 'No disponible'}`,
  `Estado local: ${diagnostic?.projectionStatus || 'No disponible'}`,
  `Salud: ${diagnostic?.healthStatus || 'No disponible'}`,
  `K: ${diagnostic?.idempotencyKeyFingerprint || 'No disponible'}`,
  `H: ${diagnostic?.requestHashFingerprint || 'No disponible'}`,
  `Creado: ${diagnostic?.createdAt || 'No disponible'}`,
  `Último intento: ${diagnostic?.lastDispatchAt || 'No disponible'}`,
  `Última consulta: ${diagnostic?.lastRecoveryAt || 'No disponible'}`,
  `Intentos de envío: ${diagnostic?.dispatchAttemptCount ?? 0}`,
  `Intentos de recuperación: ${diagnostic?.recoveryAttemptCount ?? 0}`,
  `Código de recibo: ${diagnostic?.lastReceiptStatus || 'No disponible'}`,
  `Código de protocolo: ${diagnostic?.lastProtocolCode || 'No disponible'}`,
  `Código de recuperación: ${diagnostic?.lastRecoveryCode || 'No disponible'}`,
  `Error local: ${diagnostic?.projectionErrorCode || 'No disponible'}`,
  `Lease: ${diagnostic?.recoveryLeaseState || 'NONE'}${diagnostic?.recoveryLeaseUntil ? ` (${diagnostic.recoveryLeaseUntil})` : ''}`,
  `Acciones: recibo=${Boolean(diagnostic?.allowedActions?.refreshReceipt)}, proyección=${Boolean(diagnostic?.allowedActions?.retryProjection)}`
].filter(Boolean).join('\n');
