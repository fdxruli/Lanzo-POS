// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OrderTabs from '../OrderTabs';

const orders = new Map([
  ['A', { id: 'A', tableData: 'Venta A', items: [{ quantity: 2 }], total: 20 }],
  ['B', { id: 'B', tableData: 'Venta B', items: [], total: 0 }]
]);
const props = {
  activeOrders: orders, currentOrderId: 'B',
  onSwitchOrder: vi.fn(), onCreateOrder: vi.fn(),
  onDismissInventoryNotice: vi.fn(), onOpenInventorySource: vi.fn()
};

afterEach(cleanup);

describe('Múltiples ventas: aviso contextual de stock compartido', () => {
  it('shows reliable availability without claiming it is physical stock, and opens only on tap', () => {
    render(<OrderTabs {...props} inventoryConflictNotice={{
      orderId: 'B', productName: 'Producto X',
      availableBeforeCarts: 2, provisionalInOtherCarts: 2,
      freeInThisCart: 0, sourceCount: 1,
      sourceOrderId: 'A', singleSourceLabel: 'Venta A'
    }} />);
    const notice = screen.getByRole('alert');
    expect(notice).toHaveTextContent('Sin unidades disponibles para esta venta');
    expect(notice).toHaveTextContent('Producto X');
    expect(notice).toHaveTextContent('Disponibles para vender según inventario local, antes de otras ventas: 2');
    expect(notice).toHaveTextContent('Utilizadas provisionalmente en Venta A: 2');
    expect(notice).toHaveTextContent('Unidades adicionales libres para esta venta: 0');
    expect(notice).not.toHaveTextContent('stock físico');
    expect(notice).toHaveTextContent('No se agregó el producto ni se modificó el inventario.');
    expect(props.onOpenInventorySource).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir Venta A' }));
    expect(props.onOpenInventorySource).toHaveBeenCalledOnce();
    expect(props.onSwitchOrder).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar aviso de inventario' }));
    expect(props.onDismissInventoryNotice).toHaveBeenCalledOnce();
  });

  it('does not invent the source of multiple carts or missing stock data', () => {
    render(<OrderTabs {...props} inventoryConflictNotice={{
      orderId: 'B', productName: 'Producto X',
      availableBeforeCarts: null, provisionalInOtherCarts: 2,
      freeInThisCart: null, sourceCount: 2,
      sourceOrderId: null, singleSourceLabel: null
    }} />);
    const notice = screen.getByRole('alert');
    expect(notice).toHaveTextContent('otras ventas abiertas: 2');
    expect(notice).not.toHaveTextContent('Disponibles para vender según inventario local');
    expect(notice).not.toHaveTextContent('Unidades adicionales libres para esta venta');
    expect(screen.queryByRole('button', { name: /Abrir/ })).not.toBeInTheDocument();
  });

  it('points to inventory and formal reservations when no other cart claims stock', () => {
    render(<OrderTabs {...props} inventoryConflictNotice={{
      orderId: 'B', productName: 'Producto X',
      availableBeforeCarts: 0, provisionalInOtherCarts: 0,
      freeInThisCart: 0, sourceCount: 0,
      sourceOrderId: null, singleSourceLabel: null
    }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Revisa existencias, lotes y reservas formales');
    expect(screen.queryByRole('button', { name: /Abrir/ })).not.toBeInTheDocument();
  });
});
