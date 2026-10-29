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

vi.mock('../tenantRuntimeRouter', () => ({
  getTenantRuntimeReadiness: mocks.readiness
}));

import {
  customerCreditRepository,
  startCustomerCreditAutoHealLifecycle
} from '../customerCreditRepository';

describe('customer credit auto-heal startup lifecycle', () => {
  let cleanup;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.subscribers.length = 0;
    mocks.tenantState = { status: 'GRANTED' };
    mocks.readiness.mockReturnValue({
      ready: true,
      runtime: { opaqueId: 'auto-heal-' + Math.random(), generation: 1 }
    });
    vi.spyOn(customerCreditRepository, 'runGlobalAutoHealBackground').mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('does not attach listeners or schedule work on a cold import', async () => {
    vi.resetModules();
    await import('../customerCreditRepository');
    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts only after app readiness and waits for the tenant database to open', async () => {
    const noOp = startCustomerCreditAutoHealLifecycle({ appStatus: 'loading' });
    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    noOp();

    mocks.readiness.mockReturnValue({ ready: false, runtime: null });
    cleanup = startCustomerCreditAutoHealLifecycle({ appStatus: 'ready' });
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3000);
    expect(customerCreditRepository.runGlobalAutoHealBackground).not.toHaveBeenCalled();

    mocks.readiness.mockReturnValue({
      ready: true,
      runtime: { opaqueId: 'auto-heal-restored', generation: 2 }
    });
    await vi.advanceTimersByTimeAsync(3000);

    expect(customerCreditRepository.runGlobalAutoHealBackground).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending run if tenant access is revoked before the delay ends', async () => {
    cleanup = startCustomerCreditAutoHealLifecycle({ appStatus: 'ready' });
    mocks.tenantState = { status: 'DENIED' };
    mocks.subscribers[0](mocks.tenantState);

    await vi.advanceTimersByTimeAsync(3000);

    expect(customerCreditRepository.runGlobalAutoHealBackground).not.toHaveBeenCalled();
  });
});
