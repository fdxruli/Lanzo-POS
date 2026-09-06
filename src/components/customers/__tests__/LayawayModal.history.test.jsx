// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  layaways: [],
  getByCustomer: vi.fn(),
  getSalesFinalHistory: vi.fn(),
  addPayment: vi.fn(),
  cancel: vi.fn(),
  complete: vi.fn(),
  showMessageModal: vi.fn(),
  showConfirmModal: vi.fn(),
  actorRuntime: null
}));

vi.mock('../../../services/db/layaways', () => ({
  layawayRepository: { getByCustomer: mocks.getByCustomer }
}));

vi.mock('../../../services/reports/reportsRepository', () => ({
  reportsRepository: { getSalesFinalHistory: mocks.getSalesFinalHistory }
}));

vi.mock('../../../services/layawayFinancialService', () => ({
  layawayFinancialService: {
    addPayment: mocks.addPayment,
    cancel: mocks.cancel,
    complete: mocks.complete
  }
}));

vi.mock('../../../hooks/useCaja', () => ({
  useCaja: () => ({ cajaActual: { id: 'cash-a', estado: 'abierta' } })
}));

vi.mock('../../../services/auth/useActorRuntimeSnapshot', () => ({
  useActorRuntimeSnapshot: () => mocks.actorRuntime
}));

vi.mock('../../../services/auth/refundsActorAuthorization', () => ({
  captureRefundsActorHandle: vi.fn()
}));

vi.mock('../../../services/utils', () => ({
  showMessageModal: mocks.showMessageModal,
  showConfirmModal: mocks.showConfirmModal
}));

vi.mock('../../../services/Logger', () => ({
  default: { error: vi.fn(), warn: vi.fn() }
}));

import LayawayModal from '../LayawayModal';

const layaway = (overrides = {}) => ({
  id: 'layaway-active',
  customerId: 'customer-a',
  customerName: 'Ruly',
  createdAt: '2026-09-06T10:00:00.000Z',
  updatedAt: '2026-09-06T10:00:00.000Z',
  deadline: '2026-09-30',
  totalAmount: 35,
  paidAmount: 15,
  status: 'active',
  items: [{ id: 'product-a', name: 'Producto seguro', quantity: 1, price: 35 }],
  ...overrides
});

const renderModal = () => render(
  <LayawayModal
    show
    onClose={vi.fn()}
    customer={{ id: 'customer-a', name: 'Ruly' }}
    actorIdentity="admin:admin-a"
    canManageRefunds
  />
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.actorRuntime = {
    status: 'granted', actorType: 'admin', actorId: 'admin-a', sessionId: 'session-a', permissions: ['*']
  };
  mocks.getByCustomer.mockImplementation(async () => mocks.layaways);
  mocks.getSalesFinalHistory.mockResolvedValue({ sales: [] });
});

afterEach(cleanup);

describe('LayawayModal completed history', () => {
  it('renders a completed layaway in read-only history with its linked operational folio', async () => {
    mocks.layaways = [
      layaway(),
      layaway({
        id: 'layaway-ready', status: 'ready', paidAmount: 35,
        conversionSaleId: null
      }),
      layaway({
        id: 'layaway-completed', status: 'completed', paidAmount: 35,
        deliveredAt: '2026-09-06T11:00:00.000Z', conversionSaleId: 'sale-fixture'
      })
    ];
    mocks.getSalesFinalHistory.mockResolvedValue({
      sales: [{
        id: 'sale-fixture', posFolio: 'FG-01-000061',
        request_hash: 'never-render-this', device_fingerprint: 'never-render-this'
      }]
    });

    renderModal();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Historial de apartados' })).toBeVisible();
    });

    expect(screen.getByText('Completado')).toBeVisible();
    expect(screen.getByText('Cliente: Ruly')).toBeVisible();
    expect(screen.getByText('Folio: FG-01-000061')).toBeVisible();
    expect(screen.getByRole('button', { name: /Confirmar entrega y reconocer venta/i })).toBeEnabled();
    expect(mocks.getSalesFinalHistory).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'license', customerId: 'customer-a'
    }));

    const historicalCard = screen.getByText('Folio: FG-01-000061').closest('.customer-layaway-card');
    expect(within(historicalCard).queryByRole('button', { name: /Registrar Nuevo Abono/i })).not.toBeInTheDocument();
    expect(within(historicalCard).queryByRole('button', { name: /Cancelar Apartado/i })).not.toBeInTheDocument();
    expect(within(historicalCard).queryByRole('button', { name: /Confirmar entrega/i })).not.toBeInTheDocument();
    expect(screen.queryByText('never-render-this')).not.toBeInTheDocument();
    expect(mocks.addPayment).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('keeps a standard staff request at the server-enforced mine scope', async () => {
    mocks.actorRuntime = {
      status: 'granted', actorType: 'staff', actorId: 'staff-a', sessionId: 'session-a', permissions: ['reports']
    };
    mocks.layaways = [layaway({
      id: 'layaway-completed', status: 'completed', paidAmount: 35, conversionSaleId: 'sale-own'
    })];

    renderModal();

    await waitFor(() => {
      expect(mocks.getSalesFinalHistory).toHaveBeenCalledWith(expect.objectContaining({ scope: 'mine' }));
    });
    expect(screen.getByText('Historial de apartados')).toBeVisible();
  });

  it('keeps one completed card and folio after closing and reopening the modal', async () => {
    mocks.layaways = [layaway({
      id: 'layaway-completed', status: 'completed', paidAmount: 35,
      deliveredAt: '2026-09-06T11:00:00.000Z', conversionSaleId: 'sale-fixture'
    })];
    mocks.getSalesFinalHistory.mockResolvedValue({
      sales: [{ id: 'sale-fixture', posFolio: 'FG-01-000061' }]
    });
    const onClose = vi.fn();
    const props = {
      onClose,
      customer: { id: 'customer-a', name: 'Ruly' },
      actorIdentity: 'admin:admin-a',
      canManageRefunds: true
    };
    const { rerender } = render(<LayawayModal show {...props} />);

    await screen.findByText('Folio: FG-01-000061');
    rerender(<LayawayModal show={false} {...props} />);
    rerender(<LayawayModal show {...props} />);

    await waitFor(() => {
      expect(screen.getAllByText('Folio: FG-01-000061')).toHaveLength(1);
    });
    expect(mocks.addPayment).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });
});
