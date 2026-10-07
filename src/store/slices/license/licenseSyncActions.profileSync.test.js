import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getLicenseSyncIntervalMs: vi.fn(() => 60_000),
  getLicenseSyncMode: vi.fn(() => 'hybrid_realtime'),
  isCriticalLicenseValidationReason: vi.fn(() => false),
  markLastLicenseValidationAttempt: vi.fn(),
  shouldSkipRemoteValidationAfterFailure: vi.fn(() => false),
  shouldSkipRemoteValidationForPlan: vi.fn(() => true),
  getTenantRuntimeReadiness: vi.fn(() => ({ ready: true, runtime: { opaqueId: 'sync-test', generation: 1 } }))
}));

vi.mock('./licenseGuards', () => ({
  getLicenseSyncIntervalMs: mocks.getLicenseSyncIntervalMs,
  getLicenseSyncMode: mocks.getLicenseSyncMode,
  isCriticalLicenseValidationReason: mocks.isCriticalLicenseValidationReason
}));

vi.mock('./licenseValidationTimestamps', () => ({
  markLastLicenseValidationAttempt: mocks.markLastLicenseValidationAttempt,
  shouldSkipRemoteValidationAfterFailure: mocks.shouldSkipRemoteValidationAfterFailure,
  shouldSkipRemoteValidationForPlan: mocks.shouldSkipRemoteValidationForPlan
}));

vi.mock('../../../services/db/tenantRuntimeRouter', () => ({
  getTenantRuntimeReadiness: mocks.getTenantRuntimeReadiness
}));

vi.mock('../../../services/tenant/localTenantGuard', () => ({
  assertLocalTenantSyncAccess: vi.fn(async () => ({ status: 'pass' })),
  isLocalTenantAccessError: vi.fn(() => false)
}));

import { createLicenseSyncActions } from './licenseSyncActions';

const createState = ({ mode = 'hybrid_realtime' } = {}) =¶»§q«^