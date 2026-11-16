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

const SUPPORT_FINANCIAL_STATUSES = new Set([
  'PREPARED', 'DISPATCHING', 'PENDING_RECEIPT', 'COMPLETED', 'CONFLICT', 'BLOCKED'
]);
const SUPPORT_PROJECTION_STATUSES = new Set(['NOT_REQUIRED', 'PENDING', 'APPLIED', 'FAILED']);
const SAFE_FINANCIAL_CORRELATION_ID = /^financial:v1:[a-f0-9]{40}$/i;
const SAFE_OPERATIONAL_CODE = /^[A-Z][A-Z0-9_]{1,79}$/;
const SUPPORT_OPERATIONAL_CODES = new Set([
  'FINANCIAL_RECEIPT_REFRESH_COMPLETED',
  'FINANCIAL_RECEIPT_REFRESH_PROCESSING',
  'FINANCIAL_RECEIPT_REFRESH_CONFLICT',
  'FINANCIAL_RECEIPT_REFRESH_NOT_FOUND_PREPARED',
  'FINANCIAL_RECEIPT_REFRESH_NOT_FOUND_AFTER_ATTEMPT',
  'FINANCIAL_RECEIPT_REFRESH_UNRECOGNIZED',
  'FINANCIAL_RECEIPT_REFRESH_UNAVAILABLE',
  'FINANCIAL_RECOVERY_RECEIPT_PENDING',
  'FINANCIAL_RECOVERY_RECEIPT_NOT_FOUND_AFTER_ATTEMPT',
  'FINANCIAL_RECOVERY_RECEIPT_UNAVAILABLE',
  'FINANCIAL_RECOVERY_LEASE_HELD',
  'FINANCIAL_RECOVERY_LEASE_LOST',
  'FINANCIAL_RECOVERY_LEASE_EXPIRED',
  'FINANCIAL_RECOVERY_LOCAL_PROJECTION_FAILED',
  'FINANCIAL_RECOVERY_BLOCKED_REDISPATCH',
  'FINANCIAL_RECOVERY_INCONSISTENT_PREPARED_STATE',
  'IDEMPOTENCY_CONFLICT',
  'IDEMPOTENCY_PROCESSING',
  'IDEMPOTENCY_NOT_FOUND',
  'SALE_LOCAL_PROJECTION_FAILED',
  'CASH_TOTALS_CHANGED',
  'VERSION_CONFLICT'
]);
const safeSupportDate = (value) => {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
};

/**
 * Builds the narrow allowlisted summary sent to the existing support ticket RPC.
 * It intentionally excludes tenant/actor IDs, K/H fingerprints, and all payloads.
 */
export const buildFinancialSupportTicketSummary = (diagnostic, { appVersion = null } = {}) => {
  const correlationId = typeof diagnostic?.intentId === 'string'
    && SAFE_FINANCIAL_CORRELATION_ID.test(diagnostic.intentId)
    ? diagnostic.intentId
    : null;
  const operationType = Object.prototype.hasOwnProperty.call(FINANCIAL_OPERATION_LABELS, diagnostic?.operationType)
    ? diagnostic.operationType
    : null;

  if (!correlationId || !operationType) return null;

  const financialStatus = String(diagnostic?.financialStatus || '').toUpperCase();
  const projectionStatus = String(diagnostic?.projectionStatus || '').toUpperCase();
  const codes = [diagnostic?.lastProtocolCode, diagnostic?.lastRecoveryCode, diagnostic?.projectionErrorCode]
    .filter((code) => typeof code === 'string' && SAFE_OPERATIONAL_CODE.test(code) && SUPPORT_OPERATIONAL_CODES.has(code));
  const safeVersion = typeof appVersion === 'string' && /^[A-Za-z0-9._+-]{1,32}$/.test(appVersion)
    ? appVersion
    : null;
  const intentDate = safeSupportDate(diagnostic?.createdAt);
  const latestCheck = safeSupportDate(diagnostic?.lastRecoveryAt);

  return Object.freeze({
    subject: `Revisión financiera ${correlationId}`,
    correlationId,
    message: [
      'Solicitud de revisión de una operación financiera incierta.',
      `Tipo de operación: ${operationType}`,
      `Identificador de correlación: ${correlationId}`,
      `Estado financiero: ${SUPPORT_FINANCIAL_STATUSES.has(financialStatus) ? financialStatus : 'UNKNOWN'}`,
      `Estado de proyección: ${SUPPORT_PROJECTION_STATUSES.has(projectionStatus) ? projectionStatus : 'UNKNOWN'}`,
      `Códigos operativos: ${codes.length ? [...new Set(codes)].join(', ') : 'No disponibles'}`,
      `Fecha de operación: ${intentDate || 'No disponible'}`,
      ...(latestCheck ? [`Última consulta: ${latestCheck}`] : []),
      ...(safeVersion ? [`Versión de aplicación: ${safeVersion}`] : [])
    ].join('\n')
  });
};

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
