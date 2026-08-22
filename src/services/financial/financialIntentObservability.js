import { actorRuntimeController } from '../auth/actorRuntimeController';
import { db, STORES } from '../db/dexie';
import { assertFinancialIntentRecoveryAuthority } from './financialIntentLedger';
import {
  FINANCIAL_DIAGNOSTIC_DEFAULT_LIMIT,
  FINANCIAL_DIAGNOSTIC_MAX_LIMIT,
  FINANCIAL_DIAGNOSTIC_HEALTH,
  FINANCIAL_OPERATION_LABELS,
  financialDiagnosticHealthPriority,
  toFinancialIntentDiagnostic
} from './financialIntentDiagnostics';

const ALL_STATUSES = Object.freeze(['PREPARED', 'DISPATCHING', 'PENDING_RECEIPT', 'COMPLETED', 'CONFLICT', 'BLOCKED']);
const ATTENTION_HEALTH = new Set([
  FINANCIAL_DIAGNOSTIC_HEALTH.PROJECTION_ATTENTION,
  FINANCIAL_DIAGNOSTIC_HEALTH.PREPARED_NOT_DISPATCHED,
  FINANCIAL_DIAGNOSTIC_HEALTH.RECEIPT_PENDING,
  FINANCIAL_DIAGNOSTIC_HEALTH.RECEIPT_PENDING_PROLONGED,
  FINANCIAL_DIAGNOSTIC_HEALTH.CONFLICT,
  FINANCIAL_DIAGNOSTIC_HEALTH.BLOCKED
]);

const boundedLimit = (value, fallback = FINANCIAL_DIAGNOSTIC_DEFAULT_LIMIT) => (
  Math.min(Math.max(Number(value) || fallback, 1), FINANCIAL_DIAGNOSTIC_MAX_LIMIT)
);

const normalizedStatuses = (statuses) => {
  const selected = Array.isArray(statuses)
    ? statuses.map((status) => String(status).toUpperCase()).filter((status) => ALL_STATUSES.includes(status))
    : [];
  return selected.length ? [...new Set(selected)] : ALL_STATUSES;
};

export const assertFinancialIntentObservabilityAuthority = ({ row, actorHandle }) => {
  actorHandle?.assertCurrent?.();
  if (!row || row.originTenantOpaqueId !== actorHandle?.tenant?.opaqueId || row.originTenantDatabaseName !== actorHandle?.tenant?.databaseName) {
    throw new Error('FINANCIAL_OBSERVABILITY_TENANT_MISMATCH');
  }
  if (actorHandle.actorType === 'staff' && row.originActorKey !== actorHandle.actorKey) {
    throw new Error('FINANCIAL_OBSERVABILITY_ACTOR_MISMATCH');
  }
  if (!['staff', 'admin'].includes(actorHandle.actorType)) throw new Error('FINANCIAL_OBSERVABILITY_AUTHORITY_INVALID');
  if (!FINANCIAL_OPERATION_LABELS[row.operationType]) throw new Error('FINANCIAL_OBSERVABILITY_OPERATION_UNSUPPORTED');
  return true;
};

const actionAuthority = (row, actorHandle, diagnostic) => {
  let sameRecoveryAuthority = false;
  try {
    assertFinancialIntentRecoveryAuthority(row, actorHandle);
    sameRecoveryAuthority = true;
  } catch {
    // Tenant-wide admin observability is intentionally read-only.
  }
  return Object.freeze({
    refreshReceipt: sameRecoveryAuthority && diagnostic.actionCandidates.refreshReceipt,
    retryProjection: sameRecoveryAuthority && diagnostic.actionCandidates.retryProjection,
    copyDiagnostic: true,
    requiresOriginActorLogin: !sameRecoveryAuthority
  });
};

const rowsForStatus = async ({ table, status, actorHandle, queryLimit }) => {
  if (actorHandle.actorType === 'staff') {
    return table.where('[originActorKey+status]').equals([actorHandle.actorKey, status]).limit(queryLimit).toArray();
  }
  return table.where('status').equals(status).limit(queryLimit).toArray();
};

// Every table access is bounded at the Dexie query edge. No historic ledger scan.
export const listFinancialIntentDiagnostics = async ({
  scope = 'attention',
  statuses = null,
  limit = FINANCIAL_DIAGNOSTIC_DEFAULT_LIMIT,
  before = null,
  actorHandle = null,
  currentTime = Date.now()
} = {}) => {
  const handle = actorHandle || actorRuntimeController.capture();
  handle.assertCurrent();
  const safeLimit = boundedLimit(limit);
  const table = db.table(STORES.FINANCIAL_INTENTS);
  const rows = await Promise.all(normalizedStatuses(statuses).map((status) => rowsForStatus({
    table,
    status,
    actorHandle: handle,
    queryLimit: FINANCIAL_DIAGNOSTIC_MAX_LIMIT
  })));
  handle.assertCurrent();
  const beforeTime = before ? Date.parse(before) : null;
  const diagnostics = rows.flat()
    .filter((row) => !Number.isFinite(beforeTime) || Date.parse(row.updatedAt || row.createdAt || '') < beforeTime)
    .filter((row) => {
      try {
        assertFinancialIntentObservabilityAuthority({ row, actorHandle: handle });
        return true;
      } catch {
        return false;
      }
    })
    .map((row) => {
      const diagnostic = toFinancialIntentDiagnostic(row, { currentTime });
      return Object.freeze({ ...diagnostic, allowedActions: actionAuthority(row, handle, diagnostic) });
    })
    .filter((diagnostic) => scope !== 'attention' || ATTENTION_HEALTH.has(diagnostic.healthStatus))
    .sort((left, right) => (
      financialDiagnosticHealthPriority(left) - financialDiagnosticHealthPriority(right)
      || String(right.updatedAt || right.createdAt || '').localeCompare(String(left.updatedAt || left.createdAt || ''))
    ));
  return Object.freeze(diagnostics.slice(0, safeLimit));
};

export const getFinancialIntentDiagnostic = async ({ intentId, actorHandle = null, currentTime = Date.now() } = {}) => {
  const handle = actorHandle || actorRuntimeController.capture();
  handle.assertCurrent();
  const row = await db.table(STORES.FINANCIAL_INTENTS).get(intentId);
  if (!row) return null;
  assertFinancialIntentObservabilityAuthority({ row, actorHandle: handle });
  const diagnostic = toFinancialIntentDiagnostic(row, { currentTime });
  return Object.freeze({ ...diagnostic, allowedActions: actionAuthority(row, handle, diagnostic) });
};

export const getFinancialDiagnosticSummary = async (options = {}) => {
  const diagnostics = await listFinancialIntentDiagnostics({ ...options, scope: 'all' });
  const initial = {
    visible: diagnostics.length,
    requiringAttention: 0,
    pendingReceipt: 0,
    pendingProlonged: 0,
    conflict: 0,
    blocked: 0,
    projectionFailed: 0,
    preparedNotDispatched: 0,
    activeRecoveryLeases: 0
  };
  return Object.freeze(diagnostics.reduce((summary, diagnostic) => {
    if (ATTENTION_HEALTH.has(diagnostic.healthStatus)) summary.requiringAttention += 1;
    if (diagnostic.healthStatus === FINANCIAL_DIAGNOSTIC_HEALTH.RECEIPT_PENDING) summary.pendingReceipt += 1;
    if (diagnostic.healthStatus === FINANCIAL_DIAGNOSTIC_HEALTH.RECEIPT_PENDING_PROLONGED) summary.pendingProlonged += 1;
    if (diagnostic.healthStatus === FINANCIAL_DIAGNOSTIC_HEALTH.CONFLICT) summary.conflict += 1;
    if (diagnostic.healthStatus === FINANCIAL_DIAGNOSTIC_HEALTH.BLOCKED) summary.blocked += 1;
    if (diagnostic.projectionStatus === 'FAILED') summary.projectionFailed += 1;
    if (diagnostic.healthStatus === FINANCIAL_DIAGNOSTIC_HEALTH.PREPARED_NOT_DISPATCHED) summary.preparedNotDispatched += 1;
    if (diagnostic.recoveryLeaseState === 'ACTIVE') summary.activeRecoveryLeases += 1;
    return summary;
  }, initial));
};

export const financialIntentObservabilityInternals = Object.freeze({ boundedLimit, normalizedStatuses });
