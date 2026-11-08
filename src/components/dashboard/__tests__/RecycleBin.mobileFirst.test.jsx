// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  state: {},
  loadRecycleBin: vi.fn(async () => {}),
  fetchRecycleBinPage: vi.fn(),
  restoreItem: vi.fn(async () => ({ success: true })),
  permanentlyDelete: vi.fn(async () => ({ success: true })),
  emptyBin: vi.fn(async () => ({ success: true })),
  loadRecentSales: vi.fn(async () => {}),
  showConfirmModal: vi.fn(async () => false),
  showMessageModal: vi.fn()
}));

vi.mock('../../../store/useRecycleBinStore', () => ({
  useRecycleBinStore: () => harness.state
}));
vi.mock('../../../store/useSalesStore', () => ({
  useSalesStore: (selector) => selector({ loadRecentSales: harness.loadRecentSales })
}));
vi.mock('../../../services/utils', () => ({
  showConfirmModal: harness.showConfirmModal,
  showMessageModal: harness.showMessageModal
}));
vi.mock('../../../services/auth/refundsActorAuthorization', () => ({
  captureRefundsActorHandle: vi.fn(() => ({ actor: 'test' }))
}));
vi.mock('../../../services/sales/saleReference', () => ({
  getSaleDisplayReference: (sale) => sale.folio || ''
}));

import RecycleBin from '../RecycleBin';

beforeEach(() => {
  vi.clearAllMocks();
  const first = { id: 'p-01', name: 'Arroz', mainLabel: 'Arroz', type: 'Producto', deletedAt: '2026-11-07T10:00:00Z' };
  const later = { id: 'p-51', name: 'Azúcar', mainLabel: 'Azúcar', type: 'Producto', deletedAt: '2026-11-06T10:00:00Z' };
  const sale = { id: 'sale-1', folio: 'V-092', total: 125, type: 'Pedido', deletedAt: '2026-11-05T10:00:00Z' };
  harness.state = {
    deletedItems: [first],
    allDeletedItems: [first, later, sale],
    loadRecycleBin: harness.loadRecycleBin,
    fetchRecycleBinPage: harness.fetchRecycleBinPage,
    restoreItem: harness.restoreItem,
    permanentlyDelete: harness.permanentlyDelete,
    emptyBin: harness.emptyBin,
    currentPageIndex: 0,
    totalItems: 3,
    hasPrev: false,
    hasMore: true,
    isLoading: false
  };
});

afterEach(cleanup);

describe('Papelera mobile-first', () => {
  it('busca en toda la papelera local, no solo en la página de 50 registros', () => {
    render(<RecycleBin />);
    expect(screen.getByText('Arroz')).toBeVisible();
    expect(screen.queryByText('Azúcar')).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar en toda la papelera local' }), {
      target: { value: 'Azúcar' }
    });

    expect(screen.getByText('Azúcar')).toBeVisible();
    expect(screen.getByText(/1 coincidencias en la papelera/)).toBeVisible();
    expect(screen.getByRole('button', { name: /Restaurar/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Eliminar definitivamente/ })).toBeVisible();
  });

  it('conserva el permiso de devoluciones para gestionar ventas canceladas', () => {
    render(<RecycleBin canManageSaleRefunds={false} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Filtrar elementos eliminados por tipo' }), {
      target: { value: 'Pedido' }
    });

    expect(screen.getByText('Venta V-092')).toBeVisible();
    expect(screen.getByText(/necesitas permiso de devoluciones/)).toBeVisible();
    expect(screen.getByRole('button', { name: /Restaurar/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Eliminar definitivamente/ })).toBeDisabled();
  });

  it('no elimina un elemento cuando se cancela su confirmación', async () => {
    render(<RecycleBin />);
    fireEvent.click(screen.getByRole('button', { name: /Eliminar definitivamente/ }));
    await waitFor(() => expect(harness.showConfirmModal).toHaveBeenCalledOnce());
    expect(harness.permanentlyDelete).not.toHaveBeenCalled();
  });
});
