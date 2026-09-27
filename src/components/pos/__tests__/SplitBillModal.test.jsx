// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SplitBillModal from '../SplitBillModal';

const { loadData } = vi.hoisted(() => ({ loadData: vi.fn(async () => []) }));

vi.mock('../../../services/database', () => ({
  loadData: (...args) => loadData(...args),
  STORES: { CUSTOMERS: 'customers' }
}));

const renderModal = ({ order, total, onConfirm = vi.fn(), isCajaOpen = true }) => {
  render(
    <SplitBillModal
      show
      onClose={vi.fn()}
      order={order}
      total={total}
      onConfirm={onConfirm}
      isCajaOpen={isCajaOpen}
    />
  );
  return { onConfirm };
};

describe('SplitBillModal item allocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadData.mockResolvedValue([]);
  });

  afterEach(() => cleanup());

  it('uses explicit by-items language and removes the old Manual/Equitativo choices', () => {
    renderModal({ order: [{ id: 'prod-a', name: 'Producto A', quantity: 1, price: 100 }], total: 100 });

    expect(screen.getByText('Cada quien paga lo suyo')).toBeInTheDocument();
    expect(
      within(screen.getByLabelText('Estrategia de división')).getByText(/Asigna los productos que pagará cada persona/)
    ).toBeInTheDocument();
    expect(screen.queryByText('Manual')).not.toBeInTheDocument();
    expect(screen.queryByText('Equitativo')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar división y cobro' })).toBeDisabled();
  });

  it('shows pending quantities and preserves a fractional quantity of 1.5 when assigned', () => {
    const order = [{ id: 'bulk-a', name: 'Producto a granel', saleType: 'weight', quantity: 1.5, price: 20 }];
    renderModal({ order, total: 30 });

    expect(screen.getByText('1.5 de 1.5')).toBeInTheDocument();
    const poolItem = screen.getByText('Producto a granel').closest('.split-pool-item');
    fireEvent.click(within(poolItem).getByTitle('Asignar todo a T1'));

    const ticketOne = screen.getByRole('heading', { name: 'Ticket T1' }).closest('.split-ticket-card');
    expect(within(ticketOne).getByText('x 1.5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar división y cobro' })).toBeDisabled();
  });

  it('submits by_items after assigning each product and calculating each ticket from its items', async () => {
    const order = [
      { id: 'prod-a', name: 'Producto A', quantity: 1, price: 100 },
      { id: 'prod-b', name: 'Producto B', quantity: 1, price: 200 }
    ];
    const { onConfirm } = renderModal({ order, total: 300 });
    const poolA = screen.getByText('Producto A').closest('.split-pool-item');
    const poolB = screen.getByText('Producto B').closest('.split-pool-item');

    fireEvent.click(within(poolA).getByTitle('Asignar todo a T1'));
    fireEvent.click(within(poolB).getByTitle('Asignar todo a T2'));

    const ticketOne = screen.getByRole('heading', { name: 'Ticket T1' }).closest('.split-ticket-card');
    const ticketTwo = screen.getByRole('heading', { name: 'Ticket T2' }).closest('.split-ticket-card');
    expect(within(ticketOne).getByText('$100.00')).toBeInTheDocument();
    expect(within(ticketTwo).getByText('$200.00')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar división y cobro' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());

    expect(onConfirm).toHaveBeenCalledWith({
      splitIntent: 'by_items',
      tickets: [
        expect.objectContaining({ label: 'T1', lines: [{ lineIndex: 0, quantity: 1 }] }),
        expect.objectContaining({ label: 'T2', lines: [{ lineIndex: 1, quantity: 1 }] })
      ]
    });
  });
});
