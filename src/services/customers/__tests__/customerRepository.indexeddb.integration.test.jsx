// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cloud: { upsertCustomer: vi.fn(), deleteCustomer: vi.fn(), migrateLocalCustomers: vi.fn(), pullCustomerSnapshot: vi.fn() },
  orchestrator: { registerEntitySyncHandler: vi.fn(), pullIncremental: vi.fn() }
}));

vi.mock('../customerCloudRepository', () => ({ customerCloudRepository: mocks.cloud }));
vi.mock('../../sync/posSyncOrchestrator', () => ({ posSyncOrchestrator: mocks.orchestrator }));
vi.mock('../../tenant/localTenantGuard', () => ({
  assertLocalTenantSyncAccess: vi.fn(async () => ({ status: 'pass' })),
  runWithLocalTenantSyncLease: async (_source, _options, operation) => operation(),
  isLocalTenantAccessError: (error) => String(error?.code || '').startsWith('LOCAL_TENANT_')
}));
vi.mock('../../../hooks/useDismissibleHistoryLayer', () => ({
  useDismissibleHistoryLayer: ({ onDismiss }) => onDismiss
}));

import QuickAddCustomerModal from '../../../components/common/QuickAddCustomerModal';
import CustomerForm from '../../../components/customers/CustomerForm';
import { useAppStore } from '../../../store/useAppStore';
import { db, STORES } from '../../db/dexie';
import { openTenantRuntime } from '../../db/tenantRuntimeRouter';
import { POS_SYNC_STORES, SYNC_OPERATIONS } from '../../sync/syncConstants';
import { syncOutboxService } from '../../sync/syncOutboxService';
import { openTestTenantRuntime, closeTestTenantRuntime } from '../../../test/tenantRuntimeTestHarness';
import { customerLocalRepository } from '../customerLocalRepository';
import { localCustomerToLegacyMigrationPayload } from '../customerMapper';
import { customerMigrationService } from '../customerMigrationService';
import { customerRepository } from '../customerRepository';
import { customerSyncHandler } from '../customerSyncHandler';

const TEST_LICENSE_KEY = 'license-key-sha256:test-tenant-runtime-a';
const TEST_TENANT_IDENTITY = Object.freeze({
  aliases: [TEST_LICENSE_KEY],
  primary: TEST_LICENSE_KEY,
  authority: 'license_key_sha256'
});
const CLOUD_LICENSE = {
  license_key: TEST_LICENSE_KEY,
  features: { cloud_pos_sync: true }
};

const remoteCustomer = (id, overrides = {}) => ({
  id,
  name: 'Cliente Cloud',
  phone: '5551234567',
  phone_key: '5551234567',
  address: '',
  debt: 0,
  debt_cents: 0,
  credit_limit: 0,
  created_at: '2026-10-01T10:00:00.000Z',
  updated_at: '2026-10-01T10:00:00.000Z',
  server_version: 1,
  metadata: {},
  ...overrides
});

const setCloudMode = () => useAppStore.setState({ licenseDetails: CLOUD_LICENSE });
const setFreeMode = () => useAppStore.setState({ licenseDetails: null });

beforeEach(async () => {
  await openTestTenantRuntime();
  setFreeMode();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  mocks.cloud.upsertCustomer.mockReset();
  mocks.cloud.deleteCustomer.mockReset();
  mocks.cloud.migrateLocalCustomers.mockReset();
  mocks.cloud.pullCustomerSnapshot.mockReset();
  mocks.orchestrator.registerEntitySyncHandler.mockClear();
  mocks.orchestrator.pullIncremental.mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  cleanup();
  setFreeMode();
  await closeTestTenantRuntime();
  vi.clearAllMocks();
});

describe('customerRepository IndexedDB integration', () => {
  it('SV-01/SV-02 saves and recovers a FREE customer without Cloud or server version', async () => {
    const result = await customerRepository.saveCustomer({
      id: 'free-record',
      name: 'Cliente FREE', phone: '55-1234', address: 'Centro', creditLimit: 0
    });

    expect(result).toMatchObject({ success: true });
    expect(mocks.cloud.upsertCustomer).not.toHaveBeenCalled();
    expect(await db.table(POS_SYNC_STORES.OUTBOX).count()).toBe(0);

    await closeTestTenantRuntime();
    await openTenantRuntime(TEST_TENANT_IDENTITY);
    const recovered = await customerRepository.getCustomerById('free-record');
    expect(recovered).toMatchObject({
      id: 'free-record', name: 'Cliente FREE', phone: '55-1234',
      phoneKey: '551234', syncStatus: 'local', serverVersion: null
    });
    expect(await customerRepository.searchCustomers('Cliente FREE')).toHaveLength(1);
    expect(await customerRepository.searchCustomers('55-12')).toHaveLength(1);
  });

  it('SV-02 saves a FREE customer through the Customers form and real IndexedDB repository', async () => {
    const user = userEvent.setup();
    render(<CustomerForm
      onSave={(customer) => customerRepository.saveCustomer(customer)}
      onCancel={vi.fn()}
    />);
    await user.type(screen.getByLabelText('Nombre Completo *'), 'Cliente de sección');
    await user.type(screen.getByLabelText('Teléfono *'), '5551010101');
    await user.click(screen.getByRole('button', { name: 'Guardar Cliente' }));

    await waitFor(async () => expect(await db.table(STORES.CUSTOMERS).count()).toBe(1));
    expect(await customerRepository.searchCustomers('5551010101')).toHaveLength(1);
    expect(mocks.cloud.upsertCustomer).not.toHaveBeenCalled();
  });

  it('SV-03 persists a FREE Fiado quick-add through the real form and repository', async () => {
    const user = userEvent.setup();
    const onCustomerSaved = vi.fn();
    render(<QuickAddCustomerModal
      show
      creditMode
      minimumCreditLimit={80}
      onClose={vi.fn()}
      onCustomerSaved={onCustomerSaved}
    />);
    await user.type(screen.getByLabelText('Nombre Completo *'), 'Cliente Fiado FREE');
    await user.type(screen.getByLabelText('Teléfono *'), '+52 55 9876 5432');
    await user.type(screen.getByLabelText('Límite de crédito *'), '100');
    await user.click(screen.getByRole('button', { name: 'Guardar Cliente' }));

    await waitFor(() => expect(onCustomerSaved).toHaveBeenCalledTimes(1));
    const saved = await db.table(STORES.CUSTOMERS).get(onCustomerSaved.mock.calls[0][0].id);
    expect(saved).toMatchObject({
      name: 'Cliente Fiado FREE', phone: '+52 55 9876 5432', phoneKey: '525598765432',
      syncStatus: 'local', serverVersion: null, creditLimit: 100, debt: 0
    });
    expect(mocks.cloud.upsertCustomer).not.toHaveBeenCalled();
  });

  it('keeps QuickAdd cent amounts and its pending-balance minimum without applying the Clientes $50 step', async () => {
    setCloudMode();
    mocks.cloud.upsertCustomer.mockResolvedValue({
      success: true,
      customer: remoteCustomer('quick-cents', { credit_limit: 80.25 })
    });
    const result = await customerRepository.saveCustomer({
      id: 'quick-cents', name: 'Fiado con centavos', phone: '5551110000', creditLimit: 80.25
    }, { creditLimitContext: 'quick_add', minimumCreditLimit: 80 });

    expect(result.success).toBe(true);
    expect(mocks.cloud.upsertCustomer.mock.calls[0][0].customer.credit_limit).toBe(80.25);
    expect(mocks.cloud.upsertCustomer.mock.calls[0][0].customer).not.toHaveProperty('debt');
    expect(await customerLocalRepository.getCustomerById('quick-cents')).toMatchObject({ creditLimit: 80.25, debt: 0 });

    const rejected = await customerRepository.saveCustomer({
      name: 'Fiado bajo mínimo', phone: '5551110001', creditLimit: 79.99
    }, { creditLimitContext: 'quick_add', minimumCreditLimit: 80 });
    expect(rejected).toMatchObject({ success: false, code: 'INVALID_CUSTOMER_CREDIT_LIMIT' });
    expect(mocks.cloud.upsertCustomer).toHaveBeenCalledTimes(1);
  });

  it('SV-05 creates a PRO customer online with the positive server version returned by Cloud', async () => {
    setCloudMode();
    mocks.cloud.upsertCustomer.mockResolvedValue({
      success: true,
      customer: remoteCustomer('pro-new', {
        name: 'Cliente PRO', phone: '5559090909', phone_key: '5559090909', server_version: 1
      }),
      server_version: 1,
      change_seq: 16
    });

    const result = await customerRepository.saveCustomer({
      id: 'pro-new', name: 'Cliente PRO', phone: '5559090909', creditLimit: 0,
      debt: 99, debtCents: 9900
    });

    expect(mocks.cloud.upsertCustomer).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: null }));
    expect(mocks.cloud.upsertCustomer.mock.calls[0][0].customer).not.toHaveProperty('debt');
    expect(mocks.cloud.upsertCustomer.mock.calls[0][0].customer).not.toHaveProperty('debt_cents');
    expect(result.data).toMatchObject({ id: 'pro-new', serverVersion: 1, syncStatus: 'synced' });
    expect(result.data).toMatchObject({ debt: 0, debtCents: 0 });
    expect(await db.table(STORES.CUSTOMERS).count()).toBe(1);
  });

  it('PH-05 keeps the normalized duplicate phone message and does not add another customer', async () => {
    await customerRepository.saveCustomer({
      name: 'Cliente existente', phone: '+52 (55) 1234-5678', creditLimit: 0
    });
    const user = userEvent.setup();
    const onCustomerSaved = vi.fn();
    render(<QuickAddCustomerModal show onClose={vi.fn()} onCustomerSaved={onCustomerSaved} />);
    await user.type(screen.getByLabelText('Nombre Completo *'), 'Cliente duplicado');
    await user.type(screen.getByLabelText('Teléfono *'), '525512345678');
    await user.click(screen.getByRole('button', { name: 'Guardar Cliente' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('El telefono ya esta registrado para otro cliente.');
    expect(onCustomerSaved).not.toHaveBeenCalled();
    expect(await db.table(STORES.CUSTOMERS).count()).toBe(1);
    expect(mocks.cloud.upsertCustomer).not.toHaveBeenCalled();
  });

  it('SV-04 edits a FREE historical customer without changing identity, debt, credit, or sync history', async () => {
    const legacy = {
      id: 'legacy-free', name: 'Cliente antiguo', phone: '5551112222', phoneKey: '5551112222',
      address: '', debt: 42.5, debtCents: 4250, creditLimit: 250,
      createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-02T00:00:00.000Z'
    };
    await db.table(STORES.CUSTOMERS).put(legacy);
    const existing = await customerLocalRepository.getCustomerById(legacy.id);

    const result = await customerRepository.saveCustomer({
      name: 'Cliente actualizado', phone: legacy.phone, address: legacy.address,
      creditLimit: legacy.creditLimit
    }, { existingCustomer: existing });

    expect(result.success).toBe(true);
    expect(await customerLocalRepository.getCustomerById(legacy.id)).toMatchObject({
      id: legacy.id, name: 'Cliente actualizado', debt: 42.5, debtCents: 4250,
      creditLimit: 250, serverVersion: null, syncStatus: 'local'
    });
  });

  it('SV-05 applies a positive Cloud version and preserves expectedVersion on PRO edit', async () => {
    setCloudMode();
    await db.table(STORES.CUSTOMERS).put({
      ...remoteCustomer('cloud-edit', { name: 'Antes', debt: 25, debt_cents: 2500, credit_limit: 200, server_version: 5 }),
      phoneKey: '5551234567', debt: 25, debtCents: 2500, creditLimit: 200,
      serverVersion: 5, syncStatus: 'synced'
    });
    const existing = await customerLocalRepository.getCustomerById('cloud-edit');
    mocks.cloud.upsertCustomer.mockResolvedValue({
      success: true,
      customer: remoteCustomer('cloud-edit', {
        name: 'Después', debt: 25, debt_cents: 2500,
        credit_limit: 200, server_version: 6
      }),
      server_version: 6,
      change_seq: 17
    });

    const result = await customerRepository.saveCustomer({
      name: 'Después', phone: existing.phone, address: '', creditLimit: 200
    }, { existingCustomer: existing });

    expect(mocks.cloud.upsertCustomer).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 5 }));
    expect(mocks.cloud.upsertCustomer.mock.calls[0][0].customer).not.toHaveProperty('debt');
    expect(mocks.cloud.upsertCustomer.mock.calls[0][0].customer).not.toHaveProperty('debt_cents');
    expect(result.data).toMatchObject({
      id: 'cloud-edit', serverVersion: 6, syncStatus: 'synced',
      debt: 25, debtCents: 2500, creditLimit: 200
    });
    expect(await customerLocalRepository.getCustomerById('cloud-edit')).toMatchObject({
      id: 'cloud-edit', serverVersion: 6, debt: 25, debtCents: 2500, creditLimit: 200
    });
  });

  it('keeps PRO version conflicts visible and retains the local row', async () => {
    setCloudMode();
    const existing = {
      id: 'conflicted-customer', name: 'Antes', phone: '5553334444', phoneKey: '5553334444',
      debt: 15, debtCents: 1500, creditLimit: 100, serverVersion: 5,
      syncStatus: 'synced', createdAt: '2026-10-01T00:00:00.000Z'
    };
    await db.table(STORES.CUSTOMERS).put(existing);
    mocks.cloud.upsertCustomer.mockResolvedValue({
      success: false,
      code: 'VERSION_CONFLICT',
      message: 'El cliente fue modificado en otro dispositivo.',
      customer: remoteCustomer(existing.id, { server_version: 6, debt: 15, debt_cents: 1500, credit_limit: 100 })
    });

    const result = await customerRepository.saveCustomer({
      name: 'Edición local', phone: existing.phone, creditLimit: existing.creditLimit
    }, { existingCustomer: existing });

    expect(mocks.cloud.upsertCustomer).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 5 }));
    expect(result).toMatchObject({ success: false, code: 'VERSION_CONFLICT' });
    expect(await customerLocalRepository.getCustomerById(existing.id)).toMatchObject({
      id: existing.id, syncStatus: 'conflict', debt: 15, debtCents: 1500, creditLimit: 100
    });
  });

  it('retains the original credit limit and historical debt when Cloud rejects an edit', async () => {
    setCloudMode();
    const existing = {
      id: 'rejected-limit-edit', name: 'Antes', phone: '5553334444', phoneKey: '5553334444',
      debt: 80, debtCents: 8000, creditLimit: 100, serverVersion: 5,
      syncStatus: 'synced', createdAt: '2026-10-01T00:00:00.000Z'
    };
    await db.table(STORES.CUSTOMERS).put(existing);
    mocks.cloud.upsertCustomer.mockResolvedValue({
      success: false,
      code: 'CREDIT_LIMIT_REJECTED',
      message: 'El cambio no fue aceptado.'
    });

    const result = await customerRepository.saveCustomer({
      name: 'Después', phone: existing.phone, address: '', creditLimit: 50
    }, { existingCustomer: existing });

    expect(result).toMatchObject({ success: false, code: 'CREDIT_LIMIT_REJECTED' });
    expect(mocks.cloud.upsertCustomer.mock.calls[0][0].customer).toMatchObject({ credit_limit: 50 });
    expect(mocks.cloud.upsertCustomer.mock.calls[0][0].customer).not.toHaveProperty('debt');
    expect(mocks.cloud.upsertCustomer.mock.calls[0][0].customer).not.toHaveProperty('debt_cents');
    expect(await customerLocalRepository.getCustomerById(existing.id)).toMatchObject({
      id: existing.id, creditLimit: 100, debt: 80, debtCents: 8000, serverVersion: 5, syncStatus: 'synced'
    });
  });

  it('SV-06/SV-07 queues a PRO offline customer without version zero and reapplies recovery idempotently', async () => {
    setCloudMode();
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const created = await customerRepository.saveCustomer({
      name: 'Cliente offline', phone: '5552223333', creditLimit: 0
    });

    expect(created).toMatchObject({ success: true, pending: true, data: { serverVersion: null, syncStatus: 'pending' } });
    const queued = await syncOutboxService.getPendingOperations({ licenseKey: TEST_LICENSE_KEY });
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      entityId: created.data.id,
      payload: { expectedVersion: null, customer: { id: created.data.id } }
    });
    expect(queued[0].payload.customer.server_version).toBeUndefined();
    expect(queued[0].metadata.creditLimitContext).toBe('directory');
    expect(queued[0].payload.customer).not.toHaveProperty('debt');
    expect(queued[0].payload.customer).not.toHaveProperty('debt_cents');
    expect(await db.table(STORES.CUSTOMERS).count()).toBe(1);

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    const recoveredResponse = {
      success: true,
      customer: remoteCustomer(created.data.id, {
        name: 'Cliente offline', phone: '5552223333', phone_key: '5552223333', server_version: 1
      }),
      server_version: 1,
      change_seq: 18
    };
    mocks.cloud.upsertCustomer.mockResolvedValue(recoveredResponse);

    await customerSyncHandler.pushOperation(queued[0]);
    await customerSyncHandler.pushOperation(queued[0]);
    const saved = await customerLocalRepository.getCustomerById(created.data.id);
    expect(saved).toMatchObject({ id: created.data.id, serverVersion: 1, syncStatus: 'synced' });
    expect(await db.table(STORES.CUSTOMERS).count()).toBe(1);
    expect(mocks.cloud.upsertCustomer).toHaveBeenCalledTimes(2);
    expect(mocks.cloud.upsertCustomer.mock.calls[0][0].idempotencyKey)
      .toBe(mocks.cloud.upsertCustomer.mock.calls[1][0].idempotencyKey);
  });

  it('keeps the known positive version and expectedVersion on a PRO offline edit', async () => {
    setCloudMode();
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const existing = {
      id: 'offline-edit', name: 'Antes', phone: '5551011121', phoneKey: '5551011121',
      address: '', debt: 19, debtCents: 1900, creditLimit: 100,
      serverVersion: 4, syncStatus: 'synced'
    };
    await db.table(STORES.CUSTOMERS).put(existing);

    const result = await customerRepository.saveCustomer({
      name: 'Después', phone: existing.phone, creditLimit: existing.creditLimit
    }, { existingCustomer: existing });
    const queued = await syncOutboxService.getPendingOperations({ licenseKey: TEST_LICENSE_KEY });

    expect(result).toMatchObject({ success: true, pending: true, data: { serverVersion: 4, syncStatus: 'pending' } });
    expect(queued).toHaveLength(1);
    expect(queued[0].payload.expectedVersion).toBe(4);
    expect(queued[0].metadata.creditLimitContext).toBe('directory');
    expect(await customerLocalRepository.getCustomerById(existing.id)).toMatchObject({
      id: existing.id, name: 'Después', serverVersion: 4,
      debt: 19, debtCents: 1900, creditLimit: 100
    });
    expect(queued[0].payload.customer).not.toHaveProperty('debt');
    expect(queued[0].payload.customer).not.toHaveProperty('debt_cents');
    expect(mocks.cloud.upsertCustomer).not.toHaveBeenCalled();
  });

  it('queues and recovers a PRO save after a temporary online network error', async () => {
    setCloudMode();
    mocks.cloud.upsertCustomer.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const pending = await customerRepository.saveCustomer({
      name: 'Cliente red temporal', phone: '5557778888', creditLimit: 0
    });
    expect(pending).toMatchObject({
      success: true, pending: true, data: { syncStatus: 'pending', serverVersion: null }
    });
    const queued = await syncOutboxService.getPendingOperations({ licenseKey: TEST_LICENSE_KEY });
    expect(queued).toHaveLength(1);

    mocks.cloud.upsertCustomer.mockResolvedValue({
      success: true,
      customer: remoteCustomer(pending.data.id, {
        name: 'Cliente red temporal', phone: '5557778888',
        phone_key: '5557778888', server_version: 1
      }),
      server_version: 1,
      change_seq: 19
    });
    await customerSyncHandler.pushOperation(queued[0]);

    expect(await customerLocalRepository.getCustomerById(pending.data.id)).toMatchObject({
      id: pending.data.id, syncStatus: 'synced', serverVersion: 1
    });
    expect(await db.table(STORES.CUSTOMERS).count()).toBe(1);
    expect(mocks.cloud.upsertCustomer.mock.calls[1][0].customer.id).toBe(pending.data.id);
  });

  it('SV-09 reads historical records without sync metadata and cleans version zero only on a controlled save', async () => {
    const historic = {
      id: 'historic-zero', name: 'Histórico', phone: '5554445555', phoneKey: '5554445555',
      address: '', debt: 17, debtCents: 1700, creditLimit: 100, serverVersion: 0
    };
    await db.table(STORES.CUSTOMERS).put(historic);
    expect((await customerLocalRepository.getCustomerById(historic.id)).serverVersion).toBe(0);

    setFreeMode();
    const result = await customerRepository.saveCustomer({
      name: 'Histórico editado', phone: historic.phone, creditLimit: historic.creditLimit
    }, { existingCustomer: historic });

    expect(result.success).toBe(true);
    expect(await customerLocalRepository.getCustomerById(historic.id)).toMatchObject({
      id: historic.id, serverVersion: null, debt: 17, debtCents: 1700, creditLimit: 100
    });
  });

  it('PH-07 keeps historical Cloud customers without a phone readable and applicable', async () => {
    const historical = remoteCustomer('historic-no-phone', {
      name: 'Cliente sin teléfono histórico', phone: '', phone_key: null,
      debt: 30, debt_cents: 3000, credit_limit: 75, server_version: 2
    });

    const applied = await customerLocalRepository.applyCloudCustomer(historical);
    expect(applied).toMatchObject({
      id: 'historic-no-phone', phone: '', serverVersion: 2,
      debt: 30, debtCents: 3000, creditLimit: 75, syncStatus: 'synced'
    });
    expect(await customerRepository.getCustomerById('historic-no-phone')).toMatchObject({
      phone: '', serverVersion: 2, debt: 30, creditLimit: 75
    });
  });

  it('uses the legacy migration serializer once and applies only the Cloud version returned', async () => {
    await db.table(STORES.CUSTOMERS).put({
      id: 'legacy-import', name: 'Cliente importado', phone: '', address: '',
      debt: 22, creditLimit: 90,
      createdAt: '2025-01-01T00:00:00.000Z'
    });
    mocks.cloud.migrateLocalCustomers.mockResolvedValue({
      success: true,
      results: [{
        success: true,
        customer: remoteCustomer('legacy-import', {
          name: 'Cliente importado', phone: '', phone_key: null,
          debt: 22, debt_cents: 2200, credit_limit: 90, server_version: 1
        })
      }]
    });
    mocks.cloud.pullCustomerSnapshot.mockResolvedValue({ success: true, customers: [], has_more: false });

    const result = await customerMigrationService.runInitialMigrationIfNeeded({ licenseKey: TEST_LICENSE_KEY });

    expect(result).toMatchObject({ success: true, migrated: 1, snapshotCount: 0 });
    const sentCustomer = mocks.cloud.migrateLocalCustomers.mock.calls[0][0].customers[0];
    expect(sentCustomer).toMatchObject({ id: 'legacy-import', phone: '', debt: 22, debt_cents: 2200, credit_limit: 90 });
    expect(sentCustomer.server_version).toBeUndefined();
    expect(sentCustomer.metadata).toEqual({ source: 'lanzo_pos_frontend', phase: 'fase1_customers_directory' });
    expect(await customerLocalRepository.getCustomerById('legacy-import')).toMatchObject({
      id: 'legacy-import', phone: '', serverVersion: 1, debt: 22, debtCents: 2200, creditLimit: 90
    });

    const retried = await customerMigrationService.runInitialMigrationIfNeeded({ licenseKey: TEST_LICENSE_KEY });
    expect(retried).toMatchObject({ skipped: true, reason: 'already_migrated' });
    expect(mocks.cloud.migrateLocalCustomers).toHaveBeenCalledTimes(1);
  });

  it('blocks inconsistent historical debt before the migration RPC and preserves the local value', async () => {
    const inconsistent = {
      id: 'inconsistent-legacy', name: 'Saldo inconsistente', phone: '5551002000',
      debt: 22, debtCents: 2201, creditLimit: 100
    };
    const readLegacyRows = vi.spyOn(customerLocalRepository, 'getAllActiveCustomers').mockResolvedValue([inconsistent]);
    try {
      expect(() => localCustomerToLegacyMigrationPayload(inconsistent)).toThrow('INCONSISTENT_LEGACY_CUSTOMER_DEBT');
      await expect(customerMigrationService.runInitialMigrationIfNeeded({ licenseKey: TEST_LICENSE_KEY }))
        .rejects.toThrow('INCONSISTENT_LEGACY_CUSTOMER_DEBT');
      expect(mocks.cloud.migrateLocalCustomers).not.toHaveBeenCalled();
      expect(inconsistent).toMatchObject({ debt: 22, debtCents: 2201 });
    } finally {
      readLegacyRows.mockRestore();
    }
  });

  it('rejects invalid directory limits at the repository boundary before Cloud, local storage, or outbox writes', async () => {
    setCloudMode();
    for (const creditLimit of [-50, null, 'texto', '50texto', '50.001', '50.25', Infinity, NaN, '999999999999999999999999']) {
      const result = await customerRepository.saveCustomer({
        id: `invalid-${String(creditLimit)}`, name: 'Límite inválido', phone: '5557770000', creditLimit
      });
      expect(result).toMatchObject({ success: false, code: 'INVALID_CUSTOMER_CREDIT_LIMIT' });
    }

    expect(mocks.cloud.upsertCustomer).not.toHaveBeenCalled();
    expect(await db.table(STORES.CUSTOMERS).count()).toBe(0);
    expect(await db.table(POS_SYNC_STORES.OUTBOX).count()).toBe(0);
  });

  it('blocks a stale invalid outbox limit before the synchronization RPC', async () => {
    setCloudMode();
    const result = await customerSyncHandler.pushOperation({
      id: 'invalid-limit-operation',
      idempotencyKey: 'invalid-limit-operation',
      licenseKey: TEST_LICENSE_KEY,
      operation: SYNC_OPERATIONS.UPSERT,
      entityId: 'invalid-outbox-limit',
      metadata: { creditLimitContext: 'directory' },
      payload: {
        expectedVersion: null,
        customer: {
          id: 'invalid-outbox-limit', name: 'Límite antiguo', phone: '5551112222',
          phone_key: '5551112222', credit_limit: -50
        }
      }
    });

    expect(result).toMatchObject({ conflict: { code: 'INVALID_CUSTOMER_CREDIT_LIMIT' } });
    expect(mocks.cloud.upsertCustomer).not.toHaveBeenCalled();
  });

  it('SV-10 rejects invalid remote server versions before applying Cloud data', async () => {
    setCloudMode();
    mocks.cloud.upsertCustomer.mockResolvedValue({
      success: true,
      customer: remoteCustomer('invalid-version', { server_version: 0 })
    });

    const result = await customerRepository.saveCustomer({
      name: 'Cliente inválido', phone: '5556667777', creditLimit: 0
    });
    expect(result).toMatchObject({
      success: false,
      error: { code: 'INVALID_CUSTOMER_SERVER_VERSION' }
    });
    expect(await db.table(STORES.CUSTOMERS).count()).toBe(0);
    expect(await db.table(POS_SYNC_STORES.OUTBOX).count()).toBe(0);
  });
});
