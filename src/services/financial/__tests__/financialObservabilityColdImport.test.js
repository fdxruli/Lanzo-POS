import { describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ tableTouches: 0, captureTouches: 0 }));

vi.mock('../../db/dexie', () => ({
  STORES: { FINANCIAL_INTENTS: 'financial_intents' },
  db: { table() { runtime.tableTouches += 1; throw new Error('TENANT_RUNTIME_NOT_READY'); } }
}));
vi.mock('../../auth/actorRuntimeController', () => ({
  actorRuntimeController: { capture() { runtime.captureTouches += 1; throw new Error('ACTOR_CONTEXT_LOCKED'); } }
}));
vi.mock('../financialIntentLedger', () => ({
  FINANCIAL_INTENT_STATUS: { PREPARED: 'PREPARED', DISPATCHING: 'DISPATCHING', PENDING_RECEIPT: 'PENDING_RECEIPT', COMPLETED: 'COMPLETED', CONFLICT: 'CONFLICT', BLOCKED: 'BLOCKED' },
  FINANCIAL_PROJECTION_STATUS: { PENDING: 'PENDING', FAILED: 'FAILED', APPLIED: 'APPLIED' },
  assertFinancialIntentRecoveryAuthority: vi.fn(), claimFinancialIntentRecovery: vi.fn(), getFinancialIntent: vi.fn(),
  getFinancialIntentReceiptForRecovery: vi.fn(), releaseFinancialIntentRecoveryClaim: vi.fn(), updateFinancialIntentForRecovery: vi.fn()
}));
vi.mock('../financialProjectionRegistry', () => ({ applyFinancialProjection: vi.fn() }));
vi.mock('../../cash/cashActor', () => ({ getCashMode: () => ({ cloudEnabled: false }) }));

describe('financial observability cold imports', () => {
  it('imports diagnostic, read, action, and UI graphs without a tenant runtime or cloud call', async () => {
    await expect(import('../financialIntentDiagnostics')).resolves.toBeDefined();
    await expect(import('../financialIntentObservability')).resolves.toBeDefined();
    await expect(import('../financialReceiptReconciliation')).resolves.toBeDefined();
    await expect(import('../financialProjectionRepair')).resolves.toBeDefined();
    await expect(import('../../../components/caja/sections/FinancialDiagnosticsPanel')).resolves.toBeDefined();
    expect(runtime.tableTouches).toBe(0);
    expect(runtime.captureTouches).toBe(0);
  });
});
