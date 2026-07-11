// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  activeState: null,
  appState: {},
  productState: { menu: [] },
  revalidate: vi.fn(),
  getBatchOptions: vi.fn(),
  selectBatch: vi.fn()
}));

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: () => 'no-batches'
}));

vi.mock('../../../hooks/pos/useActiveOrders', () => ({
  useActiveOrders: (selector) => selector(mocks.activeState)
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector(mocks.appState)
}));

vi.mock('../../../store/useProductStore', () => ({
  useProductStore: (selector) => selector(mocks.productState)
}));

vi.mock('../../../services/db/dexie', () => ({
  db: {},
  STORES: { PRODUCT_BATCHES: 'product_batches' }
}));

vi.mock('../../../services/ecommerce/ecommercePosInventoryResolution', () => ({
  ECOMMERCE_INVENTORY_READ_FAILED: 'ECOMMERCE_INVENTORY_READ_FAILED',
  ECOMMERCE_INVENTORY_STALE_RESPONSE: 'ECOMMERCE_INVENTORY_STALE_RESPONSE',
  getEcommerceDraftBatchOptions: mocks.getBatchOptions,
  getEcommerceInventoryLineMessage: (item) => item.inventoryMessage || 'Inventario pendiente de resolver.',
  revalidateEcommerceDraftInventory: mocks.revalidate,
  selectEcommerceDraftBatch: mocks.selectBatch
}));

vi.mock('../../../services/ecommerce/ecommercePosDraftService', () => ({
  canPrepareEcommercePosDraft: () => true
}));

import EcommercePosDraftBanner from '../EcommercePosDraftBanner';

const buildOrder = (overrides = {}) => ({
  id: 'ecom-order-1',
  origin: 'ecommerce',
  ecommerceOrderCode: 'EC-00000012',
  ecommerceDraftStatus: 'prepared',
  ecommerceInventoryStatus: 'conflict',
  ecommerceLicenseIdentity: 'context-1',
  fulfillmentMethod: 'pickup',
  expectedTotal: 50,
  currency: 'MXN',
  items: [{
    id: 'product-1',
    lineId: 'line-1',
    name: 'Producto exacto',
    quantity: 2,
    inventoryMessage: 'Sin existencia suficiente: 0 disponibles / 2 requeridos',
    inventoryResolution: { mode: 'exact', status: 'conflict', code: 'INSUFFICIENT_STOCK' }
  }],
  ...overrides
});

const buildBatchOrder = (overrides = {}) => buildOrder({
  ecommerceInventoryStatus: 'ready',
  items: [{
    id: 'product-1',
    lineId: 'line-batch',
    name: 'Producto por lote',
    quantity: 2,
    batchId: 'batch-1',
    batchManagement: { enabled: true },
    inventoryMessage: 'Lote seleccionado: LOT-001 · Caduca 2026-10-30 · 6 disponibles',
    inventoryResolution: {
      mode: 'batch',
      status: 'resolved',
      code: null,
      batchId: 'batch-1',
      selectionMode: 'manual'
    }
  }],
  ...overrides
});

const installOrder = (order) => {
  mocks.activeState = { activeOrders: new Map([[order.id, order]]) };
};

beforeEach(() => {
  vi.clearAllMocks();
  installOrder(buildOrder());
  mocks.productState = { menu: [] };
  mocks.revalidate.mockResolvedValue({ success: true });
  mocks.getBatchOptions.mockResolvedValue({ success: true, options: [] });
  mocks.selectBatch.mockResolvedValue({ success: true });
});

afterEach(() => {
  cleanup();
});

describe('EcommercePosDraftBanner inventory resolution', () => {
  it('separates prepared draft state from inventory conflict and removes the legacy next-phase warning', async () => {
    const order = mocks.activeState.activeOrders.get('ecom-order-1');
    render(
      <EcommercePosDraftBanner
        order={order}
        warnings={['Hay productos con lote pendiente de resolver en la siguiente fase.', 'El precio cambió.']}
      />
    );

    expect(screen.getByText('Estado del pedido')).toBeInTheDocument();
    expect(screen.getByText('Preparado para revisión')).toBeInTheDocument();
    expect(screen.getByText('Requiere atención')).toBeInTheDocument();
    expect(screen.getByText('Sin existencia suficiente: 0 disponibles / 2 requeridos')).toBeInTheDocument();
    expect(screen.queryByText(/siguiente fase/i)).not.toBeInTheDocument();
    expect(screen.getByText('El precio cambió.')).toBeInTheDocument();

    const resolveButton = await screen.findByRole('button', { name: 'Resolver inventario' });
    mocks.revalidate.mockClear();
    fireEvent.click(resolveButton);
    await waitFor(() => expect(mocks.revalidate).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 'ecom-order-1'
    })));
  });

  it('shows only validated batch options and persists a manual selection through the service', async () => {
    const order = buildOrder({
      ecommerceInventoryStatus: 'pending',
      items: [{
        id: 'product-1',
        lineId: 'line-batch',
        name: 'Producto por lote',
        quantity: 2,
        batchManagement: { enabled: true },
        inventoryMessage: 'No hay un lote vigente con existencia para este producto.',
        inventoryResolution: { mode: 'batch', status: 'conflict', code: 'NO_VALID_BATCH' }
      }]
    });
    installOrder(order);
    mocks.getBatchOptions.mockResolvedValue({
      success: true,
      options: [{
        batchId: 'batch-1',
        batchNumber: 'LOT-001',
        expirationDate: '2026-10-30',
        availableQuantity: 6,
        isRecommended: true,
        canCoverRequested: true
      }]
    });

    render(<EcommercePosDraftBanner order={order} />);
    fireEvent.click(screen.getByRole('button', { name: 'Seleccionar lote' }));

    expect(await screen.findByRole('dialog', { name: 'Producto por lote' })).toBeInTheDocument();
    expect(screen.getByText('FEFO recomendado')).toBeInTheDocument();
    expect(screen.getByText('Caducidad: 2026-10-30')).toBeInTheDocument();
    expect(screen.getByText('Existencia: 6')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /LOT-001/i }));
    await waitFor(() => expect(mocks.selectBatch).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 'ecom-order-1',
      lineId: 'line-batch',
      batchId: 'batch-1'
    })));
  });

  it('does not keep showing inventory ready after a current read failure', async () => {
    const order = buildOrder({
      ecommerceInventoryStatus: 'ready',
      items: [{
        id: 'product-1',
        lineId: 'line-ready',
        name: 'Producto exacto',
        quantity: 2,
        inventoryMessage: 'Existencia suficiente: 5 disponibles / 2 requeridos',
        inventoryResolution: { mode: 'exact', status: 'resolved', code: null }
      }]
    });
    installOrder(order);
    mocks.revalidate.mockResolvedValue({
      success: false,
      code: 'ECOMMERCE_INVENTORY_READ_FAILED',
      message: 'No se pudo comprobar el inventario local. Intenta resolverlo nuevamente.'
    });

    render(<EcommercePosDraftBanner order={order} />);

    await waitFor(() => expect(screen.getByText('Requiere atención')).toBeInTheDocument());
    expect(screen.queryByText('Listo')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo comprobar el inventario local');
  });

  it('ignores a stale response without showing an operational error', async () => {
    const order = buildOrder({ ecommerceInventoryStatus: 'ready' });
    installOrder(order);
    mocks.revalidate.mockResolvedValue({
      success: false,
      stale: true,
      changed: false,
      code: 'ECOMMERCE_INVENTORY_STALE_RESPONSE'
    });

    render(<EcommercePosDraftBanner order={order} />);

    await waitFor(() => expect(mocks.revalidate).toHaveBeenCalled());
    expect(screen.getByText('Listo')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('allows the resolve button to recover the UI after a read failure', async () => {
    const order = buildOrder({ ecommerceInventoryStatus: 'ready' });
    installOrder(order);
    mocks.revalidate
      .mockResolvedValueOnce({
        success: false,
        code: 'ECOMMERCE_INVENTORY_READ_FAILED',
        message: 'No se pudo comprobar el inventario local. Intenta resolverlo nuevamente.'
      })
      .mockResolvedValueOnce({ success: true, changed: true });

    render(<EcommercePosDraftBanner order={order} />);
    await waitFor(() => expect(screen.getByText('Requiere atención')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Resolver inventario' }));

    await waitFor(() => expect(screen.getByText('Listo')).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps a manual batch visible when an older automatic response returns stale', async () => {
    const order = buildOrder({
      ecommerceInventoryStatus: 'ready',
      items: [{
        id: 'product-1',
        lineId: 'line-batch',
        name: 'Producto por lote',
        quantity: 2,
        batchId: 'batch-b',
        batchManagement: { enabled: true },
        inventoryMessage: 'Lote seleccionado: LOT-B · Caduca 2026-10-30 · 4 disponibles',
        inventoryResolution: {
          mode: 'batch',
          status: 'resolved',
          code: null,
          batchId: 'batch-b',
          selectionMode: 'manual'
        }
      }]
    });
    installOrder(order);
    mocks.revalidate.mockResolvedValue({
      success: false,
      stale: true,
      code: 'ECOMMERCE_INVENTORY_STALE_RESPONSE'
    });

    render(<EcommercePosDraftBanner order={order} />);
    await waitFor(() => expect(mocks.revalidate).toHaveBeenCalled());

    expect(screen.getByText(/Lote seleccionado: LOT-B/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ends loading and fails closed when loading batch options rejects', async () => {
    const order = buildBatchOrder();
    installOrder(order);
    mocks.getBatchOptions.mockRejectedValue(new Error('Dexie failed'));

    render(<EcommercePosDraftBanner order={order} />);
    const button = screen.getByRole('button', { name: 'Cambiar lote' });
    fireEvent.click(button);

    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Requiere atención')).toBeInTheDocument();
    expect(screen.queryByText('Listo')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo comprobar el inventario local');
  });

  it('shows requires-attention and no dialog for a READ_FAILED option result', async () => {
    const order = buildBatchOrder();
    installOrder(order);
    mocks.getBatchOptions.mockResolvedValue({
      success: false,
      code: 'ECOMMERCE_INVENTORY_READ_FAILED',
      options: [],
      message: 'No se pudo comprobar el inventario local. Intenta resolverlo nuevamente.'
    });

    render(<EcommercePosDraftBanner order={order} />);
    const button = screen.getByRole('button', { name: 'Cambiar lote' });
    fireEvent.click(button);

    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Listo')).not.toBeInTheDocument();
    expect(screen.getByText('Requiere atención')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo comprobar el inventario local');
  });

  it('silently discards a stale option result and ends loading', async () => {
    const order = buildBatchOrder();
    installOrder(order);
    mocks.getBatchOptions.mockResolvedValue({
      success: false,
      stale: true,
      changed: false,
      code: 'ECOMMERCE_INVENTORY_STALE_RESPONSE',
      options: []
    });

    render(<EcommercePosDraftBanner order={order} />);
    const button = screen.getByRole('button', { name: 'Cambiar lote' });
    fireEvent.click(button);

    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Listo')).toBeInTheDocument();
    expect(screen.getByText(/Lote seleccionado: LOT-001/)).toBeInTheDocument();
  });
});
