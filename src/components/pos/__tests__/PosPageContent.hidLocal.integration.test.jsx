// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actorRuntimeController, createActorRuntimeController } from '../../../services/auth/actorRuntimeController';
import { getActiveTenantRuntime } from '../../../services/db/tenantRuntimeRouter';
import { db, STORES } from '../../../services/db/dexie';
import { openTestTenantRuntime, closeTestTenantRuntime } from '../../../test/tenantRuntimeTestHarness';
import { useActiveOrders } from '../../../hooks/pos/useActiveOrders';
import { clearCache, getCacheStats, resolveWithCache } from '../../../services/barcodeCache';
import * as resolver from '../../../services/barcodeResolver';
import * as utils from '../../../services/utils';
import { useMessageStore } from '../../../store/useMessageStore';
import PosPageContent from '../PosPageContent';
import ProductFormV2 from '../../products/form-v2/ProductFormV2';

// Only unrelated presentation/audio are replaced. Keyboard adapter, ProductMenu,
// resolver/cache, tenant Dexie schema, order initialization and mutations are real.
vi.mock('../../../services/audioBeep', () => ({ playBeep: vi.fn(), playErrorBeep: vi.fn() }));
vi.mock('../OrderSummary', () => ({ default: () => <div data-testid="order-summary" /> }));
vi.mock('../MobilePosCart', () => ({ default: () => null }));
vi.mock('../PosModals', () => ({ default: () => null }));
vi.mock('../PosFloatingBar', () => ({ default: () => null }));
vi.mock('../EcommercePosConversionPanel', () => ({ default: () => null }));
vi.mock('../OrderTabs', () => ({ default: () => null }));

const data = {
  activeTablesCount: 0,
  kitchenRejectedOpenCount: 0,
  totalItemsCount: 0,
  menuVisual: [],
  categories: [],
  activeCategoryId: null,
  searchTerm: '',
  hasOutOfStockItems: false,
  hasExpiredItems: false,
  activeOrderId: 'active-order',
  total: 0,
  toastMsg: '',
  order: [],
  customer: null,
  prescriptionItems: [],
  cajaActual: null,
  aperturaPendiente: false,
  cashActor: null,
  isCloudCash: false,
  isCloudCashReadOnly: false
};

const actions = {
  handleInitiateCheckout: vi.fn(),
  handleOpenSplitBill: vi.fn(),
  handleInitiateLayaway: vi.fn(),
  handleSaveAsOpen: vi.fn(),
  handleProcessOrder: vi.fn(),
  handlePaymentModalClose: vi.fn(),
  handleConfirmSplitBill: vi.fn(),
  handleQuickCajaSubmit: vi.fn(),
  handleQuickCajaClose: vi.fn(),
  handlePrescriptionConfirm: vi.fn(),
  handleConfirmLayaway: vi.fn(),
  handleLoadOpenOrder: vi.fn(),
  handleQuickTableAction: vi.fn(),
  fetchActiveTablesCount: vi.fn(),
  handleAnnulKitchenRejectedOrder: vi.fn()
};

const makeUi = (overrides = {}) => ({
  handleSelectCategory: vi.fn(),
  setSearchTerm: vi.fn(),
  openModal: vi.fn(),
  openMobileCart: vi.fn(),
  closeMobileCart: vi.fn(),
  closeModal: vi.fn(),
  isMobileCartOpen: false,
  activeModal: null,
  ...overrides
});


function Pos({ uiOverrides = {} }) {
  const [searchTerm, setSearchTerm] = useState('');
  return <PosPageContent data={{ ...data, searchTerm }} ui={makeUi({ setSearchTerm, ...uiOverrides })} actions={actions} features={{ hasTables: false }} />;
}
const items = (id = 'order-a') => useActiveOrders.getState().activeOrders.get(id).items;
const makeOrder = (id) => ({ id, items: [], total: 0, origin: 'pos', createdAt: '2026-11-01T12:00:00Z' });
const product = (overrides = {}) => ({ id: 'product-a', name: 'Producto A', barcode: '00123456', sku: 'SKU-A', price: 12, cost: 4, stock: 5, trackStock: true, isActive: true, ...overrides });
let now;
const scan = (code, target = document.body, terminator = 'Enter') => {
  now = Math.max(now, Date.now());
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  try {
    for (const key of code) {
      fireEvent.keyDown(target, { key });
      now += 5;
    }
    fireEvent.keyDown(target, { key: terminator });
    now += 5;
  } finally { clock.mockRestore(); }
};
const ready = async (props) => {
  const view = render(<Pos {...props} />);
  await screen.findByTestId('order-summary');
  await act(async () => {});
  return view;
};

beforeEach(async () => {
  await openTestTenantRuntime();
  const actor = createActorRuntimeController({ getTenantAuthority: getActiveTenantRuntime });
  actor.beginAuthentication({ actorType: 'staff' });
  actor.grant({ actorType: 'staff', actorId: 'one', sessionId: 's1',
    tenantOpaqueId: getActiveTenantRuntime().opaqueId, permissions: ['pos'] });
  vi.spyOn(actorRuntimeController, 'capture').mockImplementation((permission) => actor.capture(permission));
  clearCache();
  useMessageStore.getState().hide();
  useActiveOrders.setState({ activeOrders: new Map(['order-a', 'order-b'].map(id => [id, makeOrder(id)])), currentOrderId: 'order-a', isCurrentOrderLocked: false });
  await db.table(STORES.MENU).bulkPut([product(), product({ id: 'product-b', name: 'Producto B', barcode: '00987654', sku: 'SKU-B' })]);
  now = Date.now();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  closeTestTenantRuntime();
});

describe('HID → local catalog → real active order', () => {
  it('resolves a leading-zero barcode offline and adds exactly one unit despite a duplicate terminator', async () => {
    const fetch = vi.fn(() => { throw new Error('Network forbidden in local scanner QA'); });
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await ready();
    scan('00123456');
    fireEvent.keyDown(document.body, { key: 'Enter' });
    await waitFor(() => expect(items()).toHaveLength(1));
    expect(items()[0]).toMatchObject({ id: 'product-a', barcode: '00123456', quantity: 1, price: 12 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts two complete identical bursts inside 125 ms, then a different SKU and NumpadEnter', async () => {
    await ready();
    scan('SKU-A');
    scan('SKU-A');
    scan('SKU-B', document.body, 'NumpadEnter');
    await waitFor(() => expect(items().map(item => [item.id, item.quantity])).toEqual([['product-a', 2], ['product-b', 1]]));
  });

  it('uses the focused POS search as an explicit capture point and preserves manual search', async () => {
    await ready();
    const search = screen.getByRole('searchbox');
    const user = userEvent.setup({ delay: 150 });
    await user.type(search, 'Producto');
    await user.keyboard('{Enter}');
    expect(search).toHaveValue('Producto');
    expect(items()).toEqual([]);
    await user.clear(search);
    scan('00123456', search);
    await waitFor(() => expect(items()).toHaveLength(1));
    expect(search).toHaveValue('');
  });

  it('does not add an unknown code or an inactive batch SKU', async () => {
    const notice = vi.spyOn(utils, 'showMessageModal');
    await db.table(STORES.PRODUCT_BATCHES).put({ id: 'inactive', productId: 'product-a', sku: 'LOT-OFF', stock: 5, isActive: false });
    await ready();
    scan('UNKNOWN9');
    await waitFor(() => expect(notice).toHaveBeenCalledWith(expect.stringContaining('UNKNOWN9'), null, expect.any(Object)));
    useMessageStore.getState().hide();
    scan('LOT-OFF');
    await waitFor(() => expect(notice).toHaveBeenCalledWith(expect.stringContaining('LOT-OFF'), null, expect.any(Object)));
    expect(items()).toEqual([]);
  });

  it.each([
    ['inactive', { isActive: false }],
    ['inactive status', { status: 'inactive' }],
    ['archived', { status: 'archived' }],
    ['reserved out', { committedStock: 5 }],
    ['expired STRICT', { expiryDate: '2020-01-01' }]
  ])('revalidates cached batch SKU when it becomes %s', async (_label, changes) => {
    await db.table(STORES.MENU).put(product({ hasVariants: true, expirationMode: 'STRICT', batchManagement: { enabled: true } }));
    await db.table(STORES.PRODUCT_BATCHES).put({ id: 'batch-a', productId: 'product-a', sku: 'LOT-001', stock: 5, isActive: true, expiryDate: '2099-01-01' });
    expect(await resolveWithCache('LOT-001')).toMatchObject({ batchId: 'batch-a' });
    await db.table(STORES.PRODUCT_BATCHES).update('batch-a', changes);
    expect(await resolveWithCache('LOT-001')).toBeNull();
    expect(getCacheStats().hits).toBe(1);
  });

  it('rejects an inactive batch on a cold lookup and excludes it from FIFO selection', async () => {
    await db.table(STORES.MENU).put(product({ batchManagement: { enabled: true } }));
    await db.table(STORES.PRODUCT_BATCHES).bulkPut([
      { id: 'old', productId: 'product-a', sku: 'OLD-LOT', stock: 5, isActive: false, createdAt: '2020-01-01' },
      { id: 'new', productId: 'product-a', sku: 'NEW-LOT', stock: 5, isActive: true, createdAt: '2026-01-01' }
    ]);
    expect(await resolveWithCache('OLD-LOT')).toBeNull();
    expect(await resolveWithCache('00123456')).toMatchObject({ batchId: 'new' });
    await db.table(STORES.PRODUCT_BATCHES).update('new', { isActive: false });
    expect(await resolveWithCache('00123456')).toBeNull();
  });

  it('adds the exact sellable batch SKU and its commercial variant price to the order', async () => {
    await db.table(STORES.MENU).put(product({ hasVariants: true, batchManagement: { enabled: true } }));
    await db.table(STORES.PRODUCT_BATCHES).put({ id: 'variant-m', productId: 'product-a', sku: 'LOT-001', price: 18, stock: 5, isActive: true, attributes: { talla: 'M' } });
    await ready();
    scan('LOT-001');
    await waitFor(() => expect(items()).toHaveLength(1));
    expect(items()[0]).toMatchObject({ id: 'product-a', batchId: 'variant-m', price: 18, quantity: 1, isVariant: true });
    expect((await db.table(STORES.PRODUCT_BATCHES).get('variant-m')).stock).toBe(5);
  });

  it('does not carry an incomplete burst into another active order', async () => {
    const notice = vi.spyOn(utils, 'showMessageModal');
    await ready();
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      for (const key of '0012') { fireEvent.keyDown(document.body, { key }); now += 5; }
      act(() => useActiveOrders.getState().switchOrder('order-b'));
      for (const key of '3456') { fireEvent.keyDown(document.body, { key }); now += 5; }
      fireEvent.keyDown(document.body, { key: 'Enter' });
    } finally { clock.mockRestore(); }
    // The suffix is unknown; a joined burst would incorrectly resolve product-a.
    await waitFor(() => expect(notice).toHaveBeenCalledWith(expect.stringContaining('3456'), null, expect.any(Object)));
    expect(items('order-a')).toEqual([]);
    expect(items('order-b')).toEqual([]);
  });

  it.each(['switch', 'switch-back', 'payment', 'payment-close', 'lock', 'unmount'])('discards a pending real lookup after %s', async (transition) => {
    const original = resolver.resolveBarcodeResult;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const lookup = vi.spyOn(resolver, 'resolveBarcodeResult').mockImplementation(async code => { await gate; return original(code); });
    const view = await ready();
    scan('00123456');
    expect(lookup).toHaveBeenCalled();
    if (transition.startsWith('switch')) {
      act(() => useActiveOrders.getState().switchOrder('order-b'));
      if (transition === 'switch-back') act(() => useActiveOrders.getState().switchOrder('order-a'));
    } else if (transition.startsWith('payment')) {
      view.rerender(<Pos uiOverrides={{ activeModal: 'payment' }} />);
      if (transition === 'payment-close') view.rerender(<Pos />);
    } else if (transition === 'lock') {
      act(() => useActiveOrders.setState({ isCurrentOrderLocked: true }));
    } else view.unmount();
    await act(async () => { release(); await gate; });
    // Drain the actual Dexie transaction rather than asserting before resolution.
    await waitFor(() => expect(getCacheStats().size).toBe(1));
    expect(items('order-a')).toEqual([]);
    expect(items('order-b')).toEqual([]);
  });

  it.each([{ activeModal: 'payment' }, { activeModal: 'scanner' }, { isMobileCartOpen: true }])('blocks capture with UI state %j', async (uiOverrides) => {
    const lookup = vi.spyOn(resolver, 'resolveBarcodeResult');
    await ready({ uiOverrides });
    scan('00123456');
    expect(lookup).not.toHaveBeenCalled();
    expect(items()).toEqual([]);
  });

  it('blocks a nested catalog dialog even when keyboard focus stays outside it', async () => {
    const lookup = vi.spyOn(resolver, 'resolveBarcodeResult');
    const view = await ready();
    view.rerender(<><Pos /><div role="dialog" aria-modal="true">Elegir variante</div></>);
    scan('00123456');
    expect(lookup).not.toHaveBeenCalled();
    expect(items()).toEqual([]);
  });

  it('captures ProductForm barcode without resolving a product or changing an order', async () => {
    const lookup = vi.spyOn(resolver, 'resolveBarcodeResult');
    const onSave = vi.fn();
    await ready({ uiOverrides: { activeModal: 'product' } });
    render(<ProductFormV2 activeRubroContext="abarrotes" categories={[]} features={{}} onSave={onSave} onCancel={() => {}} />);
    const field = screen.getByRole('textbox', { name: /Código de barras/i });
    scan('00123456', field);
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(field).toHaveValue('00123456');
    expect(lookup).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    expect(items()).toEqual([]);
  });
});
