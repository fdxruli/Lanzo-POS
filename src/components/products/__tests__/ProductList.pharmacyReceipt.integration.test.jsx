// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProductList from '../ProductList';
import { db, STORES } from '../../../services/db/dexie';
import { openTestTenantRuntime, closeTestTenantRuntime } from '../../../test/tenantRuntimeTestHarness';
import { useAppStore } from '../../../store/useAppStore';

const mocks = vi.hoisted(() => ({
  actor: {
    status: 'granted', actorType: 'admin', actorId: 'pharmacy-ui-test',
    actorKey: 'admin:pharmacy-ui-test', generation: 1
  },
  catalogState: {
    filters: { status: 'all', categoryId: null }, setFilters: vi.fn(),
    fetchPage: vi.fn(), loadInitialProducts: vi.fn(), hasMore: false, isLoading: false
  },
  searchProductsInDB: vi.fn(async () => []),
  queryBatchesByProductIdsAndActive: vi.fn(async () => [])
}));

vi.mock('../../../services/auth/actorRuntimeController', () => ({
  ACTOR_RUNTIME_STATUS: { LOCKED: 'locked', AUTHENTICATING: 'authenticating', HANDOFF_CHECK: 'handoff_check', GRANTED: 'granted' },
  ACTOR_RUNTIME_ERROR_CODES: { CONTEXT_STALE: 'ACTOR_CONTEXT_STALE' },
  ActorRuntimeError: class ActorRuntimeError extends Error {
    constructor(code) { super(code); this.code = code; }
  },
  actorRuntimeController: {
    subscribe: vi.fn(),
    getState: vi.fn(() => mocks.actor),
    capture: vi.fn(() => ({ ...mocks.actor, assertCurrent: vi.fn() }))
  }
}));
vi.mock('../../../services/db/tenantRuntimeRouter', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getTenantRuntimeReadiness: () => ({ ready: true, runtime: {
      opaqueId: 'tenant-pharmacy-receipt-ui', databaseName: 'LanzoDB_t_tenant-pharmacy-receipt-ui', generation: 1
    } })
  };
});
vi.mock('../../../hooks/useFeatureConfig', () => ({
  useFeatureConfig: () => ({ hasBulk: true, hasExpiry: true, hasMinMax: false, hasLabFields: true, hasSKU: false, hasWholesale: false, hasWaste: false, hasDailyPricing: false })
}));
vi.mock('../../../store/useInventoryCatalogStore', () => ({
  useInventoryCatalogStore: (selector) => selector(mocks.catalogState)
}));
vi.mock('../../../services/database', () => ({
  searchProductsInDB: mocks.searchProductsInDB,
  queryBatchesByProductIdsAndActive: mocks.queryBatchesByProductIdsAndActive
}));
vi.mock('../../../services/utils', () => ({ getProductAlerts: () => ({ isLowStock: false }) }));
vi.mock('../../common/LazyImage', () => ({ default: () => <div /> }));
vi.mock('../WasteModal', () => ({ default: () => null }));
vi.mock('../ProductCloudSyncIndicators', () => ({ default: () => null }));

const freeLicense = {
  license_key: 'LANZO-FREE-PHARMACY-UI', plan_code: 'free_trial',
  valid: true, max_devices: 1, device_role: 'admin',
  features: { cloud_pos_sync: false, cloud_products_sync: false, staff_roles: false }
};

describe('Free/Local pharmacy receipt from the product action', () => {
  beforeEach(async () => {
    await openTestTenantRuntime();
    mocks.catalogState.filters = { status: 'all', categoryId: null };
    mocks.catalogState.loadInitialProducts.mockReset();
    useAppStore.setState({ licenseDetails: freeLicense, appStatus: 'ready', currentDeviceRole: 'admin',
      currentAdminUser: null, currentStaffUser: null });
    await db.table(STORES.MENU).put({
      id: 'medicine-vi', name: 'Medicamento VI', stock: 0, cost: 5, price: 20,
      trackStock: true, isActive: true, expirationMode: 'STRICT', recipe: [],
      batchManagement: { enabled: true },
      metadata: { pharmacy: { version: 1, kind: 'medicine', fraction: 'VI', status: 'confirmed' } }
    });
  });

  afterEach(() => {
    cleanup();
    closeTestTenantRuntime();
    vi.restoreAllMocks();
  });

  it('opens the real receipt modal, receives 10 documented units and persists batch and history', async () => {
    render(<ProductList products={[{
      id: 'medicine-vi', name: 'Medicamento VI', stock: 0, cost: 5, price: 20,
      trackStock: true, isActive: true, expirationMode: 'STRICT', recipe: [],
      batchManagement: { enabled: true },
      metadata: { pharmacy: { version: 1, kind: 'medicine', fraction: 'VI', status: 'confirmed' } }
    }]} categories={[]} isLoading={false} />);

    fireEvent.click(screen.getByRole('button', { name: '＋ Recibir medicamento' }));
    expect(await screen.findByRole('dialog', { name: 'Recepción de medicamento' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Cantidad a recibir/i), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/Lote del fabricante/i), { target: { value: 'VI-UI-LOT-001' } });
    fireEvent.change(screen.getByLabelText(/Caducidad del lote/i), { target: { value: '2027-12-31' } });
    fireEvent.change(screen.getByLabelText(/^Proveedor/i), { target: { value: 'Distribuidora QA' } });
    fireEvent.change(screen.getByLabelText(/Referencia del comprobante/i), { target: { value: 'FAC-UI-001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar recepción' }));

    await waitFor(async () => {
      expect(await db.table(STORES.MENU).get('medicine-vi')).toMatchObject({ stock: 10 });
    }, { timeout: 3000 });
    const batches = await db.table(STORES.PRODUCT_BATCHES).where('productId').equals('medicine-vi').toArray();
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ stock: 10, manufacturerBatchId: 'VI-UI-LOT-001', expiryDate: '2027-12-31' });
    const receipts = await db.table(STORES.INVENTORY_EVENTS).where('productId').equals('medicine-vi').toArray();
    expect(receipts).toHaveLength(1);
    expect(receipts[0].metadata.pharmacyReceipt).toMatchObject({
      supplier: 'Distribuidora QA', documentReference: 'FAC-UI-001', expiryDate: '2027-12-31'
    });
  });

  it('selects a zero-stock medicine identity for a documented local receipt', async () => {
    await db.table(STORES.PRODUCT_BATCHES).put({
      id: 'empty-ui-batch', productId: 'medicine-vi', stock: 0, isActive: false,
      status: 'inactive', manufacturerBatchId: 'VI-UI-EMPTY-001', expiryDate: '2027-12-31'
    });
    render(<ProductList products={[{
      id: 'medicine-vi', name: 'Medicamento VI', stock: 0, cost: 5, price: 20,
      trackStock: true, isActive: true, expirationMode: 'STRICT', recipe: [],
      batchManagement: { enabled: true },
      metadata: { pharmacy: { version: 1, kind: 'medicine', fraction: 'VI', status: 'confirmed' } }
    }]} categories={[]} isLoading={false} />);

    fireEvent.click(screen.getByRole('button', { name: '＋ Recibir medicamento' }));
    await screen.findByRole('dialog', { name: 'Recepción de medicamento' });
    const batchPicker = await screen.findByLabelText('Lote');
    expect(screen.getByRole('option', { name: /VI-UI-EMPTY-001/ })).toBeInTheDocument();
    fireEvent.change(batchPicker, { target: { value: 'empty-ui-batch' } });
    fireEvent.change(screen.getByLabelText(/Cantidad a recibir/i), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText(/^Proveedor/i), { target: { value: 'Distribuidora QA' } });
    fireEvent.change(screen.getByLabelText(/Referencia del comprobante/i), { target: { value: 'FAC-EMPTY-001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar recepción' }));

    await waitFor(async () => {
      expect(await db.table(STORES.PRODUCT_BATCHES).get('empty-ui-batch')).toMatchObject({ stock: 3, isActive: true });
    });
    expect((await db.table(STORES.MENU).get('medicine-vi')).stock).toBe(3);
    expect(await db.table(STORES.INVENTORY_EVENTS).count()).toBe(1);
  });

  it('requires receipt documents for medicine while leaving general-product supplier optional', async () => {
    render(<ProductList products={[{
      id: 'medicine-vi', name: 'Medicamento VI', stock: 0, trackStock: true, isActive: true,
      expirationMode: 'STRICT', batchManagement: { enabled: true },
      metadata: { pharmacy: { version: 1, kind: 'medicine', fraction: 'VI', status: 'confirmed' } }
    }, {
      id: 'general-product', name: 'Producto general', stock: 0, trackStock: true, isActive: true
    }]} categories={[]} isLoading={false} />);

    fireEvent.click(screen.getByRole('button', { name: '＋ Recibir medicamento' }));
    await screen.findByRole('dialog', { name: 'Recepción de medicamento' });
    expect(screen.getByLabelText(/^Proveedor/i)).toBeRequired();
    expect(screen.getByLabelText(/Lote del fabricante/i)).toBeRequired();
    expect(screen.getByLabelText(/Caducidad del lote/i)).toBeRequired();
    expect(screen.getByLabelText(/Referencia del comprobante/i)).toBeRequired();

    cleanup();
    render(<ProductList products={[{
      id: 'general-product', name: 'Producto general', stock: 0, trackStock: true, isActive: true
    }]} categories={[]} isLoading={false} />);
    fireEvent.click(screen.getByRole('button', { name: '＋ Agregar existencia' }));
    await screen.findByRole('dialog', { name: 'Agregar existencia' });
    expect(screen.getByLabelText(/^Proveedor/i)).not.toBeRequired();
    expect(screen.queryByLabelText(/Referencia del comprobante/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Lote del fabricante/i)).not.toBeInTheDocument();
  });
});
