// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProductList from '../ProductList';
import InventoryEntryModal from '../InventoryEntryModal';
import { markInventoryEntrySynced } from '../../../services/inventory/inventoryEntryService';
import { productCloudRepository } from '../../../services/products/productCloudRepository';
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


describe('Cloud pharmacy receipt history', () => {
  const license = {
    ...freeLicense, license_key: 'LANZO-PRO-PHARMACY-UI', plan_code: 'pro',
    features: { cloud_pos_sync: true, cloud_products_sync: true }
  };
  const medicine = (id) => ({
    id, name: `Medicamento ${id}`, trackStock: true, stock: 0, expirationMode: 'STRICT',
    batchManagement: { enabled: true },
    metadata: { pharmacy: { version: 1, kind: 'medicine', fraction: 'VI', status: 'confirmed' } }
  });
  const receipt = {
    supplier: 'Distribuidora QA', documentType: 'factura', documentReference: 'FAC-CLOUD',
    manufacturerBatchId: 'LOTE-QA', receivedAt: '2026-11-19T12:00:00Z'
  };
  const localEvent = (operationId, extra = {}) => ({
    id: `inventory-entry:${operationId}`, operationId, productId: 'A',
    type: 'INVENTORY_ENTRY', syncDisposition: 'cloud_authoritative', synced: false,
    licenseKey: license.license_key, delta: 10, timestamp: receipt.receivedAt,
    metadata: { pharmacyReceipt: receipt }, ...extra
  });
  const canonical = (operationId, extra = {}) => ({
    id: `cloud:${operationId}`, operationId, quantity: 10, receipt,
    responsible: 'Responsable Cloud', ...extra
  });
  const result = (...receipts) => ({ success: true, receipts });
  const view = (id) => <InventoryEntryModal product={medicine(id)} onClose={vi.fn()} />;

  let list;
  beforeEach(async () => {
    await openTestTenantRuntime();
    useAppStore.setState({ licenseDetails: license, appStatus: 'ready', currentDeviceRole: 'admin' });
    list = vi.spyOn(productCloudRepository, 'listPharmacyInventoryReceipts');
  });

  afterEach(() => {
    cleanup();
    closeTestTenantRuntime();
    vi.restoreAllMocks();
  });

  it('updates on confirmation, ignores an older response, and merges only by operation identity', async () => {
    const initial = Promise.withResolvers();
    const refreshed = Promise.withResolvers();
    const first = canonical('first');
    const second = canonical('second');
    list.mockReturnValueOnce(initial.promise).mockReturnValueOnce(refreshed.promise)
      .mockResolvedValue(result(first, second));
    const events = db.table(STORES.INVENTORY_EVENTS);
    await events.put(localEvent('first'));
    const { unmount } = render(view('A'));
    expect(await screen.findByText(/FAC-CLOUD.*Pendiente de sincronizar/)).toBeInTheDocument();
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    await act(() => markInventoryEntrySynced('first', {
      inventory_movement: { id: first.id, quantity: 10, actor_name: 'Responsable Cloud' }
    }));

    const confirmed = await screen.findByText(/\+10.*LOTE-QA.*Distribuidora QA.*FAC-CLOUD.*Sincronizado en Cloud/);
    expect(confirmed).toHaveTextContent('Responsable Cloud');
    expect(screen.getAllByText(/FAC-CLOUD/)).toHaveLength(1);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    await act(() => refreshed.resolve(result(first, second)));
    expect(screen.getAllByText(/FAC-CLOUD/)).toHaveLength(2);
    await act(() => initial.resolve(result()));
    expect(screen.getAllByText(/FAC-CLOUD/)).toHaveLength(2);
    expect(await events.count()).toBe(1);
    unmount();
    render(view('A'));
    await waitFor(() => expect(screen.getAllByText(/FAC-CLOUD.*Responsable Cloud/)).toHaveLength(2));
  });

  it('keeps rejected and pending rows distinct and retains the confirmation after a read failure', async () => {
    list.mockResolvedValueOnce(result()).mockRejectedValueOnce(new Error('offline'));
    const events = db.table(STORES.INVENTORY_EVENTS);
    await events.bulkPut([localEvent('first'), localEvent('rejected', {
      synced: true, rejectionCode: 'PHARMACY_LEGACY_RECEIPT_REJECTED'
    })]);
    render(view('A'));
    expect(await screen.findByText(/FAC-CLOUD.*Rechazado/)).toBeInTheDocument();
    expect(screen.getByText(/FAC-CLOUD.*Pendiente/)).toBeInTheDocument();
    expect(screen.queryByText(/FAC-CLOUD.*Sincronizado en Cloud/)).not.toBeInTheDocument();
    await act(() => markInventoryEntrySynced('first'));
    expect(await screen.findByText(/No se pudo actualizar el historial Cloud/)).toBeInTheDocument();
    expect(screen.getByText(/FAC-CLOUD.*Sincronizado en Cloud/)).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
    expect(await events.count()).toBe(2);
  });

  it('discards outstanding history reads after changing product or closing the form', async () => {
    const old = Promise.withResolvers();
    const afterClose = Promise.withResolvers();
    const recordForB = canonical('B', { receipt: { ...receipt, documentReference: 'FAC-B' } });
    list.mockReturnValueOnce(old.promise).mockResolvedValueOnce(result(recordForB))
      .mockReturnValueOnce(afterClose.promise);
    const { rerender, unmount } = render(view('A'));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    rerender(view('B'));
    expect(await screen.findByText(/FAC-B/)).toBeInTheDocument();
    await act(() => old.resolve(result(canonical('A'))));
    expect(screen.queryByText(/FAC-CLOUD/)).not.toBeInTheDocument();
    rerender(view('C'));
    expect(screen.queryByText(/FAC-B/)).not.toBeInTheDocument();
    await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
    unmount();
    await act(() => afterClose.resolve(result(canonical('C'))));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
