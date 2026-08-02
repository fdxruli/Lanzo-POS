// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BatchTable from '../BatchTable';

const baseProps = {
  features: { hasVariants: false, hasLots: true },
  productBatches: [{ id: 'batch-1', isActive: true, stock: 2, cost: 3 }],
  totalStock: 112,
  inventoryValue: 336,
  isLoadingBatches: false,
  isLoadingInitial: false,
  isLoadingNextPage: false,
  isRefreshing: false,
  loadedCount: 50,
  totalCount: 112,
  hasMore: true,
  onRefresh: vi.fn(),
  onLoadMore: vi.fn(),
  onOpenNew: vi.fn(),
  onEditBatch: vi.fn(),
  onDeleteBatch: vi.fn()
};

describe('BatchTable pagination', () => {
  afterEach(() => cleanup());

  it('muestra conteo inequívoco y un control accesible de carga acumulativa', () => {
    const onLoadMore = vi.fn();
    render(<BatchTable {...baseProps} onLoadMore={onLoadMore} />);

    expect(screen.getByText('50 de 112')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Cargar más lotes' });
    fireEvent.click(button);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('deshabilita el control y muestra progreso durante la siguiente página', () => {
    render(<BatchTable
      {...baseProps}
      isLoadingBatches
      isLoadingNextPage
    />);

    const button = screen.getByRole('button', { name: 'Cargando lotes...' });
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
  });

  it('oculta cargar más al terminar', () => {
    render(<BatchTable {...baseProps} hasMore={false} loadedCount={112} />);
    expect(screen.queryByRole('button', { name: 'Cargar más lotes' })).toBeNull();
  });

  it('bloquea acciones para estados archivados legacy aunque isArchived falte', () => {
    render(<BatchTable
      {...baseProps}
      productBatches={[{
        id: 'legacy-archived',
        isActive: true,
        status: 'removed',
        stock: 0
      }]}
      loadedCount={1}
      totalCount={1}
      hasMore={false}
    />);

    expect(screen.getByTitle('No se puede editar un lote archivado').disabled).toBe(true);
    expect(screen.getByTitle('Este lote ya está archivado').disabled).toBe(true);
  });
});
