// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  layaways: [],
  getByCustomer: vi.fn(),
  getSalesFinalHistory: vi.fn(),
  addPayment: vi.fn(),
  getPaymentReviews: vi.fn(),
  verifyPayment: vi.fn(),
  acknowledgePayment: vi.fn(),
  cancel: vi.fn(),
  complete: vi.fn(),
  showMessageModal: vi.fn(),
  showConfirmModal: vi.fn(),
  showMessage: vi.fn(),
  actorRuntime: null,
  timezone: null
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector({ companyProfile: { timezone: mocks.timezone } })
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
    getPaymentReviews: mocks.getPaymentReviews,
    verifyPayment: mocks.verifyPayment,
    acknowledgePayment: mocks.acknowledgePayment,
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

vi.mock('../../../store/useMessageStore', () => ({
  showMessage: mocks.showMessage
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
  mocks.timezone = null;
  mocks.actorRuntime = {
    status: 'granted', actorType: 'admin', actorId: 'admin-a', sessionId: 'session-a', permissions: ['*']
  };
  mocks.getByCustomer.mockImplementation(async () => mocks.layaways);
  mocks.getPaymentReviews.mockResolvedValue([]);
  mocks.getSalesFinalHistory.mockResolvedValue({ sales: [] });
});

it('offers verification for a reloaded pending payment and blocks a fresh confirmation', async () => {
  mocks.layaways = [layaway()];
  mocks.getPaymentReviews.mockResolvedValueOnce([{ id: 'intent-a', layawayId: 'layaway-active', amount: 10 }]);
  mocks.verifyPayment.mockResolvedValueOnce({ status: 'confirmed' });
  mocks.acknowledgePayment.mockResolvedValueOnce(true);
  renderModal();
  const verify = await screen.findByRole('button', { name: 'Verificar abono' });
  expect(screen.getByRole('button', { name: 'Registrar nuevo abono' })).toBeDisabled();
  await userEvent.click(verify);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Registrar nuevo abono' })).toBeEnabled());
  expect(mocks.showMessageModal).toHaveBeenCalledWith('Abono confirmado en Caja.');
  expect(mocks.addPayment).not.toHaveBeenCalled();
});

afterEach(cleanup);

describe('LayawayModal history and cancellation', () => {
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

  it('renders the same completed sale folio for two authorized admin devices', async () => {
    mocks.layaways = [layaway({
      id: 'layaway-completed', status: 'completed', paidAmount: 35,
      deliveredAt: '2026-09-06T11:00:00.000Z', conversionSaleId: 'sale-fixture'
    })];
    mocks.getSalesFinalHistory.mockResolvedValue({
      sales: [{ id: 'sale-fixture', posFolio: 'FG-01-000061' }]
    });

    for (const deviceId of ['device-a', 'device-b']) {
      mocks.actorRuntime = {
        status: 'granted', actorType: 'admin', actorId: 'admin-a',
        sessionId: `session-${deviceId}`, deviceId, licenseId: 'license-shared', permissions: ['*']
      };
      const view = renderModal();
      await screen.findByText('Folio: FG-01-000061');
      expect(screen.getByText('Completado')).toBeVisible();
      view.unmount();
    }

    expect(mocks.getSalesFinalHistory).toHaveBeenCalledTimes(2);
    expect(mocks.getSalesFinalHistory).toHaveBeenNthCalledWith(1, expect.objectContaining({ scope: 'license' }));
    expect(mocks.getSalesFinalHistory).toHaveBeenNthCalledWith(2, expect.objectContaining({ scope: 'license' }));
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

  it('does not cancel or refund when the paid-funds decision is dismissed', async () => {
    mocks.layaways = [layaway()];
    mocks.showConfirmModal.mockResolvedValueOnce(true);
    let fundsDecisionOptions;
    mocks.showMessage.mockImplementationOnce((_message, _onConfirm, options) => {
      fundsDecisionOptions = options;
    });

    renderModal();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Cancelar Apartado/i }));
    await waitFor(() => expect(fundsDecisionOptions).toBeDefined());

    expect(fundsDecisionOptions.confirmButtonText).toBe('Reembolsar al cliente');
    expect(fundsDecisionOptions.extraButton.text).toBe('Retener el dinero');
    expect(fundsDecisionOptions.cancelButtonText).toBe('Volver sin cancelar');
    fundsDecisionOptions.onCancel();

    await waitFor(() => {
      expect(mocks.cancel).not.toHaveBeenCalled();
      expect(mocks.showMessageModal).not.toHaveBeenCalled();
    });
  });

  it('requires the explicit Retener action to retain paid funds', async () => {
    mocks.layaways = [layaway()];
    mocks.showConfirmModal.mockResolvedValueOnce(true);
    mocks.showMessage.mockImplementationOnce((_message, _onConfirm, options) => {
      options.extraButton.action();
    });

    renderModal();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Cancelar Apartado/i }));

    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith(expect.objectContaining({
      layawayId: 'layaway-active',
      retainMoney: true,
      expectedCashSessionId: 'cash-a'
    })));
  });

  it('registers a refund only when the explicit Reembolsar action is chosen', async () => {
    mocks.layaways = [layaway()];
    mocks.showConfirmModal.mockResolvedValueOnce(true);
    mocks.showMessage.mockImplementationOnce((_message, onConfirm) => onConfirm());

    renderModal();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Cancelar Apartado/i }));

    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith(expect.objectContaining({
      layawayId: 'layaway-active',
      retainMoney: false,
      expectedCashSessionId: 'cash-a'
    })));
  });

  it('keeps a Cloud installment available without a timezone when the old UI allowed it', async () => {
    mocks.layaways = [layaway({ deadline: '2030-12-31' })];
    mocks.addPayment.mockResolvedValue({ isFullyPaid: false });
    renderModal();
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: /Registrar nuevo abono/i });
    expect(button).toBeEnabled();
    await user.click(button);
    await user.type(screen.getByRole('spinbutton'), '5');
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(mocks.addPayment).toHaveBeenCalledWith(expect.objectContaining({
      layawayId: 'layaway-active', amount: 5, expectedCashSessionId: 'cash-a'
    })));
    expect(mocks.showMessageModal).not.toHaveBeenCalledWith(expect.stringContaining('zona horaria'),
      null, expect.anything());
  });

  it('retains the old overdue UI block without a timezone rather than enabling a new payment', async () => {
    mocks.layaways = [layaway({ deadline: '2020-01-01' })];
    renderModal();
    const button = await screen.findByRole('button', { name: /Abonos bloqueados/i });
    expect(button).toBeDisabled();
    expect(mocks.addPayment).not.toHaveBeenCalled();
  });

});
