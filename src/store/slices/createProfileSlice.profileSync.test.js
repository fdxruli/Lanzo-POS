import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getBusinessProfile: vi.fn(),
  revalidateLicense: vi.fn(),
  assertLocalTenantSyncAccess: vi.fn(async () => ({ status: 'pass' })),
  actorRuntimeCapture: vi.fn(),
  actorHandle: {
    actorType: 'admin',
    sessionId: 'admin-session',
    assertCurrent: vi.fn()
  },
  loadData: vi.fn(),
  saveBusinessProfile: vi.fn(),
  saveData: vi.fn(async () => undefined),
  saveLicenseToStorage: vi.fn(async () => undefined),
  getTenantRuntimeReadiness: vi.fn(() => ({ ready: true, runtime: { opaqueId: 'profile-test', generation: 1 } }))
}));

vi.mock('../../services/database', () => ({
  loadData: mocks.loadData,
  saveData: mocks.saveData,
  STORES: { COMPANY: 'company' }
}));

vi.mock('../../services/supabase', () => ({
  getBusinessProfile: mocks.getBusinessProfile,
  revalidateLicense: mocks.revalidateLicense,
  saveBusinessProfile: mocks.saveBusinessProfile
}));

vi.mock('../../services/licenseStorage', () => ({
  saveLicenseToStorage: mocks.saveLicenseToStorage
}));

vi.mock('../../services/storage/imageUploadService', () => ({
  IMAGE_UPLOAD_PURPOSES: { BUSINESS_LOGO: 'business-logo' },
  uploadImageFile: vi.fn()
}));

vi.mock('../../services/tenant/localTenantGuard', () => ({
  assertLocalTenantSyncAccess: mocks.assertLocalTenantSyncAccess,
  isLocalTenantAccessError: (error) => String(error?.code || '').startsWith('LOCAL_TENANT_')
}));

vi.mock('../../services/db/tenantRuntimeRout¶»§q«^