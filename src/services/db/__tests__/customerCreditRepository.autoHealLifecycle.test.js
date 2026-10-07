import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tenantState: { status: 'GRANTED' },
  subscribers: [],
  readiness: vi.fn(() => ({ ready: true, runtime: { opaqueId: 'auto-heal-test', generation: 1 } })),
  subscribe: vi.fn((listener) => {
    mocks.subscribers.push(listener);
    return () => {
      const index = mocks.subscribers.indexOf(listener);
      if (index >= 0) mocks.subscribers.splice(index, 1);
    };
  })
}));

vi.mock('../../tenant/localTenantPolicy', () => ({
  LOCAL_TENANT_STATUS: { GRANTED: 'GRANTED' },
  localTenantAccessController: {
    getState: () => mocks.tenantState,
    subscribe: mocks.subscribe
  }
}));

vi.mock('../dexie', () => ({ db: {}, STORES: {} }));
vi.mock('../../utils', () => ({ generateID: vi.fn() }));
vi.mock('../utils', () => ({ DatabaseError: class DatabaseError extends Error {}, DB_ERROR_CODES: {} }));
vi.mock('../customerDebtIndex', () => ({ normalizeCustomerDebtCents: vi.fn((value) => value) }));
vi.mock('../../../utils/moneyMath', () => ({ Money: { init: vi.fn((value) => ({ lte: () => Number(value) <= 0 })) } }));
vi.mock('../../cajaService', () => ({ registrarMovimientoCajaEnTransaccion: vi.fn() }));
vi.mock('../../cash/cashActor', () => ({ getCashActorFromState: vi.fn() }));
vi.mock('../../cash/cashStation', () => ({ getCashStationIdentity: vi.fn() }));
vi.mock('../../cash/cashFinancialGate', () => ({ captureCashActorContext: vi.fn() }));

vi.mock('../tenantRuntimeRou¶»§q«^