// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SplitBillModal from '../SplitBillModal';

const { loadData, tenantStorage } = vi.hoisted(() => ({
  loadData: vi.fn(async () => []),
  tenantStorage: { ready: true, namespace: 'tenant-test', values: new Map() }
}));

vi.mock('../../../services/database', () => ({
  loadData: (...args) => loadData(...args),
  saveDataSafe: vi.fn(),
  DB_ERROR_CODES: { DUPLICATE_CUSTOMER_PHONE: 'DUPLICATE_CUSTOMER_PHONE' },
  STORES: { CUSTOMERS: 'customers' }
}));

vi.mock('../../../services/tenant/tenantScopedStorage', () => ({
  getTenantStorageState: () => ({ ready: tenantStorage.ready, opaqueId: tenantStorage.namespace }),
  getTenantStorageItem: (key) => tenantStorage.ready ? (tenantStorage.values.get(`${tenantStorage.namespace}:${key}`) ?? null) : null,
  setTenantStorageItem: (key, value) => {
    if (tenantStorage.ready) tenantStorage.values.set(`${tenantStorage.namespace}:${key}`, value);
  },
  removeTenantStorageItem: (key) => {
    if (tenantStorage.ready) tenantStorage.values.delete(`${tenantStorage.namespace}:${key}`);
  }
}));

const renderModal = ({
  order,
  total,
  saleDiscount = null,
  onConfirm = vi.fn(async () => ({ success: true })),
  onClose = vi.fn(),
  isCajaOpen = true,
  orderId = 'order-1',
  tableName = 'Mesa 4',
  show = true
}) => {
  const props = { order, total, saleDiscount, onConfirm, onClose, isCajaOpen, orderId, tableName };
  const view = render(<SplitBillModal {...props} show={show} />);
  return {
    ...view,
    onConfirm,
    onClose,
    setShow: (nextShow) => view.rerender(<SplitBillModal {...props} show={nextShow} />)
  };
};

const goToItems = () => fireEvent.click(screen.getByRole('button', { name: 'Asignar platos' }));
const goToPayment = () => fireEvent.click(screen.getByRole('button', { name: 'Configurar cobro' }));
const goToReview = () => fireEvent.click(screen.getByRole('button', { name: 'Revisar división' }));
const getPendingLine = (name) => {
  const pending = screen.getByRole('tabpanel', { name: 'Platos pendientes' });
  return within(pending).getByText(name).closest('.split-pool-item');
};
const getGuestCard = (name) => {
  const heading = screen.getByRole('heading', { name: new RegExp(name) });
  return heading.closest('.split-ticket-card');
};

describe('SplitBillModal four-step restaurant split', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tenantStorage.ready = true;
    tenantStorage.namespace = 'tenant-test';
    tenantStorage.values.clear();
    loadData.mockResolvedValue([]);
  });

  afterEach(() => cleanup());

  it('never processes a sale while advancing from Cobro to Revisar or through an implicit form submit', async () => {
    const { onConfirm } = renderModal({
      order: [
        { lineId: 'navigation-a', id: 'product-a', name: 'Producto A', quantity: 1, price: 100 },
        { lineId: 'navigation-b', id: 'product-b', name: 'Producto B', quantity: 1, price: 50 }
      ],
      total: 150,
      orderId: 'safe-review-navigation'
    });
    goToItems();
    fireEvent.click(within(getPendingLine('Producto A')).getByRole('button', { name: 'Asignar todas las unidades restantes de Producto A a Comensal 1 · Comensal 1' }));
    fireEvent.click(within(getPendingLine('Producto B')).getByRole('button', { name: 'Asignar todas las unidades restantes de Producto B a Comensal 2 · Comensal 2' }));
    goToPayment();

    const advance = screen.getByRole('button', { name: 'Revisar división' });
    expect(advance).toHaveAttribute('type', 'button');
    fireEvent.click(advance);
    expect(screen.getByRole('heading', { name: 'Revisa antes de confirmar' })).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();

    // Enter in a payment input must never implicitly submit the financial operation.
    fireEvent.submit(document.querySelector('.split-bill-form'));
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole('button', { name: 'Cobro' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Revisar' }));
    expect(screen.getByRole('heading', { name: 'Revisa antes de confirmar' })).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();

    const finalConfirm = screen.getByRole('button', { name: 'Confirmar división y cobro' });
    expect(finalConfirm).toHaveAttribute('type', 'button');
    fireEvent.click(finalConfirm);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
  });

  it('submits only once if confirmation is re-entered before the first request settles', async () => {
    let resolveConfirmation;
    const confirmButtonRef = { current: null };
    const onConfirm = vi.fn(() => {
      if (onConfirm.mock.calls.length === 1) {
        confirmButtonRef.current.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }
      return new Promise((resolve) => { resolveConfirmation = resolve; });
    });
    renderModal({
      order: [
        { lineId: 'double-submit-a', id: 'product-a', name: 'Producto A', quantity: 1, price: 100 },
        { lineId: 'double-submit-b', id: 'product-b', name: 'Producto B', quantity: 1, price: 50 }
      ],
      total: 150,
      onConfirm
    });
    goToItems();
    fireEvent.click(within(getPendingLine('Producto A')).getByRole('button', { name: 'Asignar todas las unidades restantes de Producto A a Comensal 1 · Comensal 1' }));
    fireEvent.click(within(getPendingLine('Producto B')).getByRole('button', { name: 'Asignar todas las unidades restantes de Producto B a Comensal 2 · Comensal 2' }));
    goToPayment();
    goToReview();

    const confirmButton = screen.getByRole('button', { name: 'Confirmar división y cobro' });
    confirmButtonRef.current = confirmButton;
    fireEvent.click(confirmButton);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(confirmButton).toBeDisabled();

    resolveConfirmation({ success: true });
    await waitFor(() => expect(confirmButton).toBeDisabled());
  });

  it('starts with two guests, supports optional names up to eight, and keeps names separate from financial IDs', async () => {
    const { onConfirm } = renderModal({
      order: [
        { lineId: 'line-a', id: 'product-a', name: 'Producto A', quantity: 1, price: 100 },
        { lineId: 'line-b', id: 'product-b', name: 'Producto B', quantity: 1, price: 50 }
      ],
      total: 150
    });

    expect(screen.getByLabelText('Nombre de Comensal 1 (opcional)')).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre de Comensal 2 (opcional)')).toBeInTheDocument();
    const guestCount = screen.getByLabelText('¿Cuántas personas?');
    fireEvent.change(guestCount, { target: { value: '8' } });
    expect(screen.getByLabelText('Nombre de Comensal 8 (opcional)')).toBeInTheDocument();

    fireEvent.change(guestCount, { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Nombre de Comensal 1 (opcional)'), { target: { value: ' Ana ' } });
    fireEvent.blur(screen.getByLabelText('Nombre de Comensal 1 (opcional)'));
    goToItems();

    const productA = getPendingLine('Producto A');
    const productB = getPendingLine('Producto B');
    fireEvent.click(within(productA).getByRole('button', { name: 'Asignar todas las unidades restantes de Producto A a Ana · Comensal 1' }));
    fireEvent.click(within(productB).getByRole('button', { name: 'Asignar todas las unidades restantes de Producto B a Comensal 2 · Comensal 2' }));
    goToPayment();
    goToReview();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar división y cobro' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    const payload = onConfirm.mock.calls[0][0];
    expect(payload.splitIntent).toBe('by_items');
    expect(payload.tickets.map((ticket) => ticket.label)).toEqual(['T1', 'T2']);
    expect(payload.tickets[0]).not.toHaveProperty('displayName');
  });

  it('preserves existing assignments when adding a guest and confirms before returning a removed guest’s quantities', () => {
    renderModal({
      order: [
        { lineId: 'line-a', id: 'product-a', name: 'Producto A', quantity: 1, price: 100 },
        { lineId: 'line-b', id: 'product-b', name: 'Producto B', quantity: 2, price: 20 }
      ],
      total: 140
    });
    goToItems();
    fireEvent.click(within(getPendingLine('Producto A')).getByRole('button', { name: 'Asignar todas las unidades restantes de Producto A a Comensal 1 · Comensal 1' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Personas' })[0]);
    fireEvent.change(screen.getByLabelText('¿Cuántas personas?'), { target: { value: '3' } });
    goToItems();
    expect(getGuestCard('Comensal 1').querySelector('.split-ticket-items')).toHaveTextContent('Producto A');

    fireEvent.click(within(getPendingLine('Producto B')).getByRole('button', { name: 'Asignar todas las unidades restantes de Producto B a Comensal 3 · Comensal 3' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Personas' })[0]);
    fireEvent.change(screen.getByLabelText('¿Cuántas personas?'), { target: { value: '2' } });

    const confirmation = screen.getByRole('alertdialog');
    expect(confirmation).toHaveTextContent('volverán a “Platos pendientes”');
    expect(within(confirmation).getByRole('button', { name: 'Conservar personas' })).toBeInTheDocument();
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Quitar y devolver cantidades' }));
    goToItems();
    expect(getPendingLine('Producto B')).toHaveTextContent('Pendiente: 2 de 2.');
    expect(screen.getByRole('button', { name: 'Configurar cobro' })).toBeDisabled();
  });

  it('assigns the Mesa 4 example, shows per-person totals, and confirms the unchanged by_items contract once', async () => {
    const order = [
      { lineId: 'hamb-1', id: 'hamburger', name: 'Hamburguesa', quantity: 2, price: 100 },
      { lineId: 'pasta-1', id: 'pasta', name: 'Pasta', quantity: 1, price: 150 },
      { lineId: 'drink-1', id: 'soda', name: 'Refresco', quantity: 3, price: 30 }
    ];
    const { onConfirm } = renderModal({ order, total: 440, orderId: 'mesa-4' });
    fireEvent.change(screen.getByLabelText('¿Cuántas personas?'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Nombre de Comensal 1 (opcional)'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('Nombre de Comensal 2 (opcional)'), { target: { value: 'Luis' } });
    fireEvent.change(screen.getByLabelText('Nombre de Comensal 3 (opcional)'), { target: { value: 'Carlos' } });
    goToItems();

    fireEvent.click(within(getPendingLine('Hamburguesa')).getByRole('button', { name: '+1 a Ana' }));
    fireEvent.click(within(getPendingLine('Hamburguesa')).getByRole('button', { name: '+1 a Luis' }));
    fireEvent.click(within(getPendingLine('Pasta')).getByRole('button', { name: 'Asignar todas las unidades restantes de Pasta a Carlos · Comensal 3' }));
    fireEvent.click(within(getPendingLine('Refresco')).getByRole('button', { name: '+1 a Ana' }));
    fireEvent.click(within(getPendingLine('Refresco')).getByRole('button', { name: '+1 a Luis' }));
    fireEvent.click(within(getPendingLine('Refresco')).getByRole('button', { name: '+1 a Carlos' }));

    expect(getGuestCard('Ana').querySelector('.split-ticket-total')).toHaveTextContent('$130.00');
    expect(getGuestCard('Luis').querySelector('.split-ticket-total')).toHaveTextContent('$130.00');
    expect(getGuestCard('Carlos').querySelector('.split-ticket-total')).toHaveTextContent('$180.00');
    goToPayment();
    goToReview();
    expect(screen.getByText('Mesa 4')).toBeInTheDocument();
    expect(screen.getByText('Total asignado')).toBeInTheDocument();
    expect(document.querySelector('.split-review-total')).toHaveTextContent('Pendiente por asignar0');
    const confirmButton = screen.getByRole('button', { name: 'Confirmar división y cobro' });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(onConfirm).toHaveBeenCalledWith({
      splitIntent: 'by_items',
      tickets: [
        expect.objectContaining({ label: 'T1', lines: [{ lineIndex: 0, quantity: 1 }, { lineIndex: 2, quantity: 1 }] }),
        expect.objectContaining({ label: 'T2', lines: [{ lineIndex: 0, quantity: 1 }, { lineIndex: 2, quantity: 1 }] }),
        expect.objectContaining({ label: 'T3', lines: [{ lineIndex: 1, quantity: 1 }, { lineIndex: 2, quantity: 1 }] })
      ]
    });
  });

  it('shows cumulative unit assignments and keeps the completed distribution visible through return and reassignment', () => {
    renderModal({
      order: [{ lineId: 'pine-water-line', id: 'pine-water', name: 'Agua de piña', quantity: 3, price: 25 }],
      total: 75
    });
    fireEvent.change(screen.getByLabelText('Nombre de Comensal 1 (opcional)'), { target: { value: 'Ruly' } });
    fireEvent.change(screen.getByLabelText('Nombre de Comensal 2 (opcional)'), { target: { value: 'Norma' } });
    goToItems();

    const product = getPendingLine('Agua de piña');
    const summary = product.querySelector('.split-assignment-summary');
    expect(summary).toHaveAttribute('aria-live', 'polite');
    expect(within(product).getByText('Cada clic añade una unidad a la persona elegida. Puedes pulsar varias veces.')).toBeInTheDocument();
    expect(summary).toHaveTextContent(/Ruly\s*×\s*0/);
    expect(summary).toHaveTextContent(/Norma\s*×\s*0/);
    expect(summary).toHaveTextContent('Pendiente: 3 de 3.');

    fireEvent.click(within(product).getByRole('button', { name: '+1 a Ruly' }));
    expect(summary).toHaveTextContent(/Ruly\s*×\s*1/);
    expect(summary).toHaveTextContent(/Norma\s*×\s*0/);
    expect(summary).toHaveTextContent('Pendiente: 2 de 3.');

    fireEvent.click(within(product).getByRole('button', { name: '+1 a Norma' }));
    expect(summary).toHaveTextContent(/Ruly\s*×\s*1/);
    expect(summary).toHaveTextContent(/Norma\s*×\s*1/);
    expect(summary).toHaveTextContent('Pendiente: 1 de 3.');

    fireEvent.click(within(product).getByRole('button', { name: '+1 a Ruly' }));
    expect(summary).toHaveTextContent(/Ruly\s*×\s*2/);
    expect(summary).toHaveTextContent(/Norma\s*×\s*1/);
    expect(summary).toHaveTextContent('Pendiente: 0 de 3.');
    expect(product).toHaveClass('completed');
    expect(within(product).getByText('Completamente repartido')).toBeInTheDocument();

    const rulyLine = within(getGuestCard('Ruly')).getByText('Agua de piña').closest('.split-ticket-item');
    fireEvent.click(within(rulyLine).getByRole('button', {
      name: 'Regresar una unidad de Agua de piña de Ruly · Comensal 1 a platos pendientes'
    }));
    expect(summary).toHaveTextContent(/Ruly\s*×\s*1/);
    expect(summary).toHaveTextContent(/Norma\s*×\s*1/);
    expect(summary).toHaveTextContent('Pendiente: 1 de 3.');

    fireEvent.click(within(product).getByRole('button', { name: '+1 a Norma' }));
    expect(summary).toHaveTextContent(/Ruly\s*×\s*1/);
    expect(summary).toHaveTextContent(/Norma\s*×\s*2/);
    expect(summary).toHaveTextContent('Pendiente: 0 de 3.');

    const normaLine = within(getGuestCard('Norma')).getByText('Agua de piña').closest('.split-ticket-item');
    fireEvent.click(within(normaLine).getByRole('button', {
      name: 'Regresar todo Agua de piña de Norma · Comensal 2 a platos pendientes'
    }));
    expect(summary).toHaveTextContent(/Ruly\s*×\s*1/);
    expect(summary).toHaveTextContent(/Norma\s*×\s*0/);
    expect(summary).toHaveTextContent('Pendiente: 2 de 3.');

    fireEvent.click(within(product).getByRole('button', {
      name: 'Asignar todas las unidades restantes de Agua de piña a Ruly · Comensal 1'
    }));
    expect(summary).toHaveTextContent(/Ruly\s*×\s*3/);
    expect(summary).toHaveTextContent(/Norma\s*×\s*0/);
    expect(summary).toHaveTextContent('Pendiente: 0 de 3.');
    expect(product).toHaveClass('completed');
  });

  it('supports fractional quantities without changing unit prices or creating a fictional shared unit', () => {
    renderModal({
      order: [{ lineId: 'bulk-line', id: 'bulk-a', name: 'Queso', saleType: 'weight', quantity: 1.5, price: 20 }],
      total: 30
    });
    goToItems();
    const pendingLine = getPendingLine('Queso');
    fireEvent.change(within(pendingLine).getByLabelText('O asignar otra cantidad'), { target: { value: '0.5' } });
    fireEvent.click(within(pendingLine).getByRole('button', { name: 'Asignar cantidad de Queso a Comensal 1 · Comensal 1' }));
    fireEvent.click(within(getPendingLine('Queso')).getByRole('button', { name: 'Asignar todas las unidades restantes de Queso a Comensal 2 · Comensal 2' }));
    expect(getGuestCard('Comensal 1').querySelector('.split-ticket-items')).toHaveTextContent('× 0.5');
    expect(getGuestCard('Comensal 2').querySelector('.split-ticket-items')).toHaveTextContent('× 1');
    expect(screen.getByText(/Elige “Dividir el total en partes iguales”/)).toBeInTheDocument();
    expect(screen.queryByText('SPLIT_INTENT_NOT_SUPPORTED')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Configurar cobro' })).toBeEnabled();
  });

  it('submits an equal monetary split as two stable payer rows on the original account', async () => {
    const onConfirm = vi.fn(async () => ({ success: true }));
    renderModal({
      order: [{ lineId: 'shared-food', id: 'pizza', name: 'Pizza para compartir', quantity: 1, price: 101 }],
      total: 101,
      onConfirm,
      orderId: 'equal-monetary'
    });
    fireEvent.change(screen.getByLabelText('Nombre de Comensal 1 (opcional)'), { target: { value: 'Ana' } });
    fireEvent.click(screen.getByRole('radio', { name: /Dividir el total en partes iguales/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Distribuir importe' }));
    expect(screen.getByText('Total distribuido').parentElement).toHaveTextContent('$101.00');

    fireEvent.click(screen.getByRole('button', { name: 'Configurar cobro' }));
    fireEvent.change(document.getElementById('splitPaid-T1'), { target: { value: '55.00' } });
    fireEvent.change(document.getElementById('splitPaymentMethod-T2'), { target: { value: 'tarjeta' } });
    goToReview();
    expect(screen.getByRole('heading', { name: 'Revisa antes de confirmar' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar división y cobro' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    const payload = onConfirm.mock.calls[0][0];
    expect(payload.splitIntent).toBe('equal_payment');
    expect(payload.tickets.map((ticket) => ticket.amountCents)).toEqual([5050, 5050]);
    expect(payload.tickets.map((ticket) => ticket.lines)).toEqual([[], []]);
    expect(payload.tickets.map((ticket) => ticket.label)).toEqual(['T1', 'T2']);
    expect(payload.tickets[0]).not.toHaveProperty('displayName');
    expect(payload.tickets[0].paymentData).toMatchObject({ paymentMethod: 'efectivo', amountPaid: '55', receivedAmount: '55' });
    expect(payload.tickets[1].paymentData.paymentMethod).toBe('tarjeta');
  });

  it('validates custom cents and accepts card and transfer without item allocation', async () => {
    const onConfirm = vi.fn(async () => ({ success: true }));
    renderModal({
      order: [{ lineId: 'shared-pasta', id: 'pasta', name: 'Pasta para compartir', quantity: 1, price: 100.01 }],
      total: 100.01,
      onConfirm,
      orderId: 'custom-monetary'
    });
    fireEvent.click(screen.getByRole('radio', { name: /Ingresar montos personalizados/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar montos' }));
    fireEvent.change(document.getElementById('splitCustomAmount-T1'), { target: { value: '60.00' } });
    fireEvent.change(document.getElementById('splitCustomAmount-T2'), { target: { value: '40.01' } });
    expect(screen.getByRole('button', { name: 'Configurar cobro' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Configurar cobro' }));
    fireEvent.change(document.getElementById('splitPaymentMethod-T1'), { target: { value: 'tarjeta' } });
    fireEvent.change(document.getElementById('splitPaymentMethod-T2'), { target: { value: 'transferencia' } });
    goToReview();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar división y cobro' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    const payload = onConfirm.mock.calls[0][0];
    expect(payload.splitIntent).toBe('custom_payment');
    expect(payload.tickets.map((ticket) => ticket.amountCents)).toEqual([6000, 4001]);
    expect(payload.tickets.map((ticket) => ticket.lines)).toEqual([[], []]);
    expect(payload.tickets.map((ticket) => ticket.paymentData.paymentMethod)).toEqual(['tarjeta', 'transferencia']);
  });

  it('restores a valid monetary draft with integer-cent custom shares', async () => {
    const view = renderModal({
      order: [{ lineId: 'draft-shared', id: 'shared', name: 'Cuenta', quantity: 1, price: 100 }],
      total: 100,
      orderId: 'monetary-draft'
    });
    fireEvent.click(screen.getByRole('radio', { name: /Ingresar montos personalizados/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar montos' }));
    fireEvent.change(document.getElementById('splitCustomAmount-T1'), { target: { value: '30.00' } });
    fireEvent.change(document.getElementById('splitCustomAmount-T2'), { target: { value: '70.00' } });
    await waitFor(() => expect([...tenantStorage.values.values()].some((value) => value.includes('custom_payment'))).toBe(true));

    view.setShow(false);
    view.setShow(true);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Se restauró el borrador local'));
    expect(screen.getByRole('heading', { name: 'Ingresa los montos de cada persona' })).toBeInTheDocument();
    expect(document.getElementById('splitCustomAmount-T1')).toHaveValue('30.00');
    expect(document.getElementById('splitCustomAmount-T2')).toHaveValue('70.00');
    expect(screen.getByText('Total distribuido').parentElement).toHaveTextContent('$100.00');
  });

  it('returns one or all items to pending and can move a line directly between people', () => {
    renderModal({
      order: [
        { lineId: 'soda-line', id: 'soda', name: 'Refresco', quantity: 3, price: 30 },
        { lineId: 'pasta-line', id: 'pasta', name: 'Pasta', quantity: 2, price: 100 }
      ],
      total: 290
    });
    goToItems();
    fireEvent.click(within(getPendingLine('Refresco')).getByRole('button', { name: 'Asignar todas las unidades restantes de Refresco a Comensal 1 · Comensal 1' }));
    fireEvent.click(within(getPendingLine('Pasta')).getByRole('button', { name: 'Asignar todas las unidades restantes de Pasta a Comensal 2 · Comensal 2' }));
    expect(getGuestCard('Comensal 1').querySelector('.split-ticket-items')).not.toHaveTextContent('Pasta');
    expect(getGuestCard('Comensal 2').querySelector('.split-ticket-items')).toHaveTextContent('Pasta× 2');

    const sodaLine = within(getGuestCard('Comensal 1')).getByText('Refresco').closest('.split-ticket-item');
    fireEvent.click(within(sodaLine).getByRole('button', { name: 'Regresar una unidad de Refresco de Comensal 1 · Comensal 1 a platos pendientes' }));
    expect(getPendingLine('Refresco')).toHaveTextContent('Pendiente: 1 de 3.');
    fireEvent.click(within(getPendingLine('Refresco')).getByRole('button', { name: '+1 a Comensal 2' }));
    const pastaLine = within(getGuestCard('Comensal 2')).getByText('Pasta').closest('.split-ticket-item');
    fireEvent.change(within(pastaLine).getByRole('combobox', { name: 'Mover Pasta de Comensal 2 · Comensal 2 a otra persona' }), { target: { value: '0' } });
    expect(getGuestCard('Comensal 1').querySelector('.split-ticket-items')).toHaveTextContent('Pasta× 2');
    expect(getGuestCard('Comensal 2').querySelector('.split-ticket-items')).not.toHaveTextContent('Pasta');
    const pastaInFirst = within(getGuestCard('Comensal 1')).getByText('Pasta').closest('.split-ticket-item');
    fireEvent.click(within(pastaInFirst).getByRole('button', { name: 'Regresar todo Pasta de Comensal 1 · Comensal 1 a platos pendientes' }));
    expect(getPendingLine('Pasta')).toHaveTextContent('Pendiente: 2 de 2.');
  });

  it('keeps same-name product lines separate and shows their modifiers and notes', async () => {
    const order = [
      { lineId: 'burger-line-a', id: 'burger', name: 'Hamburguesa', quantity: 1, price: 100, selectedModifiers: [{ name: 'Sin cebolla' }], notes: 'Bien cocida' },
      { lineId: 'burger-line-b', id: 'burger', name: 'Hamburguesa', quantity: 1, price: 100, selectedModifiers: [{ name: 'Sin pepinillos' }], notes: 'Pan tostado' }
    ];
    const { onConfirm } = renderModal({ order, total: 200 });
    fireEvent.change(screen.getByLabelText('Nombre de Comensal 1 (opcional)'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('Nombre de Comensal 2 (opcional)'), { target: { value: 'Ana' } });
    goToItems();

    const productLines = within(screen.getByRole('tabpanel', { name: 'Platos pendientes' })).getAllByText('Hamburguesa').map((node) => node.closest('.split-pool-item'));
    expect(productLines).toHaveLength(2);
    fireEvent.click(within(productLines[0]).getByRole('button', { name: 'Asignar todas las unidades restantes de Hamburguesa a Ana · Comensal 1' }));
    fireEvent.click(within(productLines[1]).getByRole('button', { name: 'Asignar todas las unidades restantes de Hamburguesa a Ana · Comensal 2' }));
    expect(getGuestCard('Comensal 1').querySelector('.split-ticket-items')).toHaveTextContent('Sin cebolla');
    expect(getGuestCard('Comensal 1').querySelector('.split-ticket-items')).toHaveTextContent('Bien cocida');
    expect(getGuestCard('Comensal 2').querySelector('.split-ticket-items')).toHaveTextContent('Sin pepinillos');
    expect(getGuestCard('Comensal 2').querySelector('.split-ticket-items')).toHaveTextContent('Pan tostado');

    goToPayment();
    goToReview();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar división y cobro' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(onConfirm.mock.calls[0][0].tickets.map((ticket) => ticket.lines)).toEqual([
      [{ lineIndex: 0, quantity: 1 }],
      [{ lineIndex: 1, quantity: 1 }]
    ]);
  });

  it('lets mobile users switch between pending dishes and people without losing assignment state', () => {
    renderModal({
      order: [
        { lineId: 'a', id: 'product-a', name: 'Producto A', quantity: 1, price: 100 },
        { lineId: 'b', id: 'product-b', name: 'Producto B', quantity: 1, price: 50 }
      ],
      total: 150
    });
    goToItems();
    fireEvent.click(within(getPendingLine('Producto A')).getByRole('button', { name: 'Asignar todas las unidades restantes de Producto A a Comensal 1 · Comensal 1' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Personas · 2' }));
    expect(screen.getByRole('tabpanel', { name: 'Asignado a cada persona' })).toHaveTextContent('Producto A');
    expect(screen.getByRole('tab', { name: 'Personas · 2' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Platos pendientes · 1' }));
    expect(getPendingLine('Producto B')).toHaveTextContent('Pendiente: 1 de 1.');
    expect(screen.getByRole('tabpanel', { name: 'Asignado a cada persona' })).toHaveTextContent('Producto A');
  });

  it('keeps line and sale discounts in canonical ticket totals', () => {
    const order = [
      { lineId: 'a', id: 'product-a', name: 'Producto A', quantity: 1, price: 100, discount: { type: 'amount', value: 10, amount: 10, reason: 'Promoción de línea' } },
      { lineId: 'b', id: 'product-b', name: 'Producto B', quantity: 1, price: 200 }
    ];
    const saleDiscount = { type: 'amount', value: 30, amount: 30, reason: 'Promoción general', scope: 'sale' };
    renderModal({ order, total: 260, saleDiscount });
    goToItems();
    fireEvent.click(within(getPendingLine('Producto A')).getByRole('button', { name: 'Asignar todas las unidades restantes de Producto A a Comensal 1 · Comensal 1' }));
    fireEvent.click(within(getPendingLine('Producto B')).getByRole('button', { name: 'Asignar todas las unidades restantes de Producto B a Comensal 2 · Comensal 2' }));
    expect(getGuestCard('Comensal 1').querySelector('.split-ticket-total')).toHaveTextContent('$80.69');
    expect(getGuestCard('Comensal 2').querySelector('.split-ticket-total')).toHaveTextContent('$179.31');
    expect(getGuestCard('Comensal 1').querySelector('.split-ticket-discount')).toHaveTextContent('Descuento: -$19.31');
    expect(getGuestCard('Comensal 2').querySelector('.split-ticket-discount')).toHaveTextContent('Descuento: -$20.69');
    expect(getGuestCard('Comensal 1').querySelector('.split-ticket-adjustment')).toBeNull();
  });

  it('keeps guest names separate from Fiado customer selection, credit validation and receipt controls', async () => {
    loadData.mockResolvedValue([{ id: 'customer-1', name: 'Cliente registrado', phone: '555', debt: 0, creditLimit: 500 }]);
    renderModal({
      order: [
        { lineId: 'a', id: 'product-a', name: 'Producto A', quantity: 1, price: 100 },
        { lineId: 'b', id: 'product-b', name: 'Producto B', quantity: 1, price: 50 }
      ],
      total: 150
    });
    fireEvent.change(screen.getByLabelText('Nombre de Comensal 1 (opcional)'), { target: { value: 'Ana' } });
    goToItems();
    fireEvent.click(within(getPendingLine('Producto A')).getByRole('button', { name: 'Asignar todas las unidades restantes de Producto A a Ana · Comensal 1' }));
    fireEvent.click(within(getPendingLine('Producto B')).getByRole('button', { name: 'Asignar todas las unidades restantes de Producto B a Comensal 2 · Comensal 2' }));
    goToPayment();

    const paymentCard = screen.getByRole('heading', { name: /Ana · Comensal 1/ }).closest('.split-payment-card');
    const method = within(paymentCard).getByLabelText('Método de pago');
    fireEvent.change(method, { target: { value: 'fiado' } });
    expect(within(paymentCard).getByLabelText('Cliente financiero registrado')).toBeInTheDocument();
    expect(within(paymentCard).getByLabelText('Enviar ticket por WhatsApp')).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Cliente registrado (555)' })).toBeInTheDocument());
    fireEvent.change(within(paymentCard).getByLabelText('Cliente financiero registrado'), { target: { value: 'customer-1' } });
    expect(screen.getByRole('button', { name: 'Revisar división' })).toBeEnabled();
  });

  it('restores safe payment method choices without restoring amounts, references or customers', async () => {
    loadData.mockResolvedValue([{ id: 'customer-1', name: 'Cliente registrado', phone: '555', debt: 0, creditLimit: 500 }]);
    const order = [
      { lineId: 'a', id: 'product-a', name: 'Producto A', quantity: 1, price: 100 },
      { lineId: 'b', id: 'product-b', name: 'Producto B', quantity: 1, price: 50 }
    ];
    const view = renderModal({ order, total: 150, orderId: 'table-4' });
    fireEvent.change(screen.getByLabelText('Nombre de Comensal 1 (opcional)'), { target: { value: 'Ana' } });
    goToItems();
    fireEvent.click(within(getPendingLine('Producto A')).getByRole('button', { name: 'Asignar todas las unidades restantes de Producto A a Ana · Comensal 1' }));
    fireEvent.click(within(getPendingLine('Producto B')).getByRole('button', { name: 'Asignar todas las unidades restantes de Producto B a Comensal 2 · Comensal 2' }));
    goToPayment();
    const methods = screen.getAllByLabelText('Método de pago');
    fireEvent.change(methods[0], { target: { value: 'tarjeta' } });
    fireEvent.change(methods[1], { target: { value: 'fiado' } });
    fireEvent.change(screen.getByLabelText('Método del abono inicial'), { target: { value: 'transferencia' } });
    fireEvent.change(screen.getByLabelText('Referencia o folio (opcional)'), { target: { value: 'sensitive-reference' } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'Cliente registrado (555)' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Cliente financiero registrado'), { target: { value: 'customer-1' } });
    await waitFor(() => expect([...tenantStorage.values.values()].some((value) => value.includes('Ana'))).toBe(true));
    const serialized = [...tenantStorage.values.values()][0];
    expect(serialized).toContain('"paymentMethod":"card"');
    expect(serialized).toContain('"paymentMethod":"credit"');
    expect(serialized).toContain('"initialPaymentMethod":"transfer"');
    expect(serialized).not.toContain('amountPaid');
    expect(serialized).not.toContain('customerId');
    expect(serialized).not.toContain('paymentReference');
    expect(serialized).not.toContain('sensitive-reference');
    expect(serialized).not.toContain('customer-1');

    view.setShow(false);
    view.setShow(true);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Se restauró el borrador local'));
    expect(screen.getByRole('heading', { name: /Ana · Comensal 1/ })).toBeInTheDocument();
    const restoredMethods = screen.getAllByLabelText('Método de pago');
    expect(restoredMethods[0]).toHaveValue('tarjeta');
    expect(restoredMethods[1]).toHaveValue('fiado');
    expect(screen.getByLabelText('Método del abono inicial')).toHaveValue('transferencia');
    expect(screen.getByLabelText('Abono inicial aplicado')).toHaveValue('0');
    expect(screen.getByLabelText('Cliente financiero registrado')).toHaveValue('');
  });

  it('discards a draft when the order snapshot changes, and does not leak it between tenants or tables', async () => {
    const order = [{ lineId: 'a', id: 'product-a', name: 'Producto A', quantity: 2, price: 100 }];
    const view = renderModal({ order, total: 200, orderId: 'table-4' });
    goToItems();
    fireEvent.click(within(getPendingLine('Producto A')).getByRole('button', { name: 'Asignar todas las unidades restantes de Producto A a Comensal 1 · Comensal 1' }));
    await waitFor(() => expect(tenantStorage.values.size).toBeGreaterThan(0));

    view.setShow(false);
    const changedOrder = [{ ...order[0], quantity: 3 }];
    view.rerender(<SplitBillModal show order={changedOrder} total={300} onConfirm={vi.fn()} onClose={vi.fn()} orderId="table-4" />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('La cuenta cambió'));
    goToItems();
    expect(getPendingLine('Producto A')).toHaveTextContent('Pendiente: 3 de 3.');

    tenantStorage.namespace = 'tenant-other';
    view.setShow(false);
    view.setShow(true);
    await waitFor(() => expect(screen.queryByText('La cuenta cambió')).not.toBeInTheDocument());
  });

  it('shows the active cash-session requirement and supports Escape without losing the draft', async () => {
    const view = renderModal({
      order: [
        { lineId: 'a', id: 'product-a', name: 'Producto A', quantity: 1, price: 100 },
        { lineId: 'b', id: 'product-b', name: 'Producto B', quantity: 1, price: 20 }
      ],
      total: 120,
      isCajaOpen: false
    });
    goToItems();
    fireEvent.click(within(getPendingLine('Producto A')).getByRole('button', { name: 'Asignar todas las unidades restantes de Producto A a Comensal 1 · Comensal 1' }));
    fireEvent.click(within(getPendingLine('Producto B')).getByRole('button', { name: 'Asignar todas las unidades restantes de Producto B a Comensal 2 · Comensal 2' }));
    goToPayment();
    expect(screen.getByText(/Se verificará la sesión operativa de caja al confirmar/)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(view.onClose).toHaveBeenCalledOnce();
    await waitFor(() => expect(tenantStorage.values.size).toBeGreaterThan(0));
  });
});
