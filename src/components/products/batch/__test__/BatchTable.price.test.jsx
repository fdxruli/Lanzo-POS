// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BatchTable from '../BatchTable';

const baseProps = {
  features: { hasVariants: false, hasLots: true },
  totalStock: 10,
  inventoryValue: 120,
  isLoadingBatches: false,
  isLoadingInitial: false,
  isLoadingNextPage: false,
  isRefreshing: false,
  loadedCount: 1,
  totalCount: 1,
  hasMore: false,
  onRefresh: vi.fn(),
  onLoadMore: vi.fn(),
  onOpenNew: vi.fn(),
  onEditBatch: vi.fn(),
  onDeleteBatch: vi.fn()
};

describe('BatchTable sale price', () => {
  afterEach(() => cleanup());

  it('shows the parent product price for physical batches with a legacy batch price', () => {
    render(<BatchTable
      {...baseProps}
      product={{ id: 'amoxicilina', price: 22.98, hasVariants: false }}
      productBatches={[{ id: 'lote-a', isActive: true, stock: 10, price: 25 }]}
    />);

    expect(screen.getByRole('columnheader', { name: 'Precio del producto' })).toBeTruthy();
    expect(screen.getByText('$22.98')).toBeTruthy();
    expect(screen.queryByText('$25.00')).toBeNull();
  });

  it('shows the variant price for commercial variants', () => {
    render(<BatchTable
      {...baseProps}
      product={{ id: 'camiseta', price: 200, hasVariants: true }}
      features={{ hasVariants: true, hasLots: false }}
      productBatches={[{
        id: 'camiseta-m-negro',
        isActive: true,
        stock: 10,
        price: 220,
        attributes: { talla: 'M', color: 'Negro' }
      }]}
    />);

    expect(screen.getByRole('columnheader', { name: 'Precio de variante' })).toBeTruthy();
    expect(screen.getByText('$220.00')).toBeTruthy();
    expect(screen.queryByText('$200.00')).toBeNull();
  });
});
