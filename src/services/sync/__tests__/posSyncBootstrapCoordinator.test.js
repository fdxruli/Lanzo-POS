// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  logs: [],
  start: vi.fn(async () => ({ started: true })),
  stop: vi.fn(async () => undefined),
  assertAccess: vi.fn(async () => undefined)
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: {
    getState: () => ({
      licenseDetails: { license_key: 'license-a', plan_code: 'pro' },
      currentDeviceRole: 'admin',
      currentStaffUser: { id: 'staff-a' }
    })
  }
}));
vi.mock('../../Logger', () => ({ default: {
  log: (message, meta) => mocks.logs.push({ message, meta }),
  warn: vi.fn(), error: vi.fn()
} }));
vi.mock('../../tenant/localTenantGuard', () => ({
  assertLocalTenantSyncAccess: mocks.assertAccess,
  runWithLocalTenantSyncLease: vi.fn(async (_source, _options, operation) => operation())
}));
vi.mock('../posSyncOrchestrator', () => ({ posSyncOrchestrator: {
  start: mocks.start, stop: mocks.stop,
  schedulePullIncremental: vi.fn(async () => undefined),
  processOutbox: vi.fn(async () => undefined)
} }));
vi.mock('../../products/productLocalRepository', () => ({
  productLocalRepository: { getLocalCatalogForMigration: vi.fn(async () => ({ products: [{}] })) }
}));
vi.mock('../../products/productSyncHandler', () => ({ productSyncHandler: { onStart: vi.fn() } }));
vi.mock('../../customers/customerSyncHandler', () => ({ customerSyncHandler: { onStart: vi.fn() } }));
vi.mock('../../customerCredit/customerCreditSyncHandler', () => ({ customerCreditSyncHandler: { onStart: vi.fn() } }));
vi.mock('../../cash/cashSyncHandler', () => ({ cashSyncHandler: { onStart: vi.fn() } }));
vi.mock('../../salesCloud/salesCloudSyncHandler', () => ({ salesCloudSyncHandler: { onStart: vi.fn() } }));
vi.mock('../syncConstants', () => ({
  getLicenseKeyFromDetails: (details) => details?.license_key || null,
  isCloudPosSyncEnabled: () => true,
  POS_BOOTSTRAP_JITTER_MS: { MIN: 0, MAX: 0 },
  POS_BOOTSTRAP_RESOURCES: {
    POS: 'pos', PRODUCTS: 'products', CUSTOMERS: 'customers', CASH: 'cash', CREDIT: 'credit', SALES: 'sales', REPORTS: 'reports'
  },
  POS_DEFERRED_SNAPSHOT_DELAY_MS: { PRODUCTS: 0, CUSTOMERS: 0, CASH: 0, CREDIT: 0, SALES: 0, REPORTS: 0 }
}));

import {
  startPosCloudBootstrap,
  stopPosCloudBootstrap
} from '../posSyncBootstrapCoordinator';

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('posSyncBootstrapCoordinator route demand ownership', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    mocks.logs.length = 0;
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
    await stopPosCloudBootstrap();
  });

  afterEach(async () => {
    await stopPosCloudBootstrap();
    vi.useRealTimers();
  });

  it('does not re-emit route demand when an already-started bootstrap is requested', async () => {
    await expect(startPosCloudBootstrap({ reason: 'first' })).resolves.toMatchObject({ started: true });
    await flush();
    const firstPosDemandCount = mocks.logs.filter(({ message, meta }) => (
      message.includes('module demand') && meta?.resource === 'pos'
    )).length;

    await expect(startPosCloudBootstrap({ reason: 'duplicate' })).resolves.toEqual({
      started: true, skipped: true, reason: 'already_started'
    });
    await flush();

    expect(firstPosDemandCount).toBe(1);
    expect(mocks.logs.filter(({ message, meta }) => (
      message.includes('module demand') && meta?.resource === 'pos'
    ))).toHaveLength(1);
    expect(mocks.start).toHaveBeenCalledTimes(1);

    window.history.pushState({}, '', '/productos');
    await vi.runOnlyPendingTimersAsync();
    await flush();
    expect(mocks.logs.filter(({ message, meta }) => (
      message.includes('module demand') && meta?.resource === 'products'
    ))).toHaveLength(1);
  });
});
