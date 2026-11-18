// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import BatchTable, { formatBatchCalendarDate } from '../BatchTable';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const props = (product, productBatches) => ({
  product, features: { hasExpiry: true }, productBatches, totalStock: 0, inventoryValue: 0,
  isLoadingBatches: false, isLoadingInitial: false, isLoadingNextPage: false, isRefreshing: false,
  loadedCount: productBatches.length, totalCount: productBatches.length, hasMore: false,
  onRefresh: vi.fn(), onLoadMore: vi.fn(), onOpenNew: vi.fn(), onEditBatch: vi.fn(), onDeleteBatch: vi.fn()
});

describe('pharmacy lot calendar identity', () => {
  it('formats an ISO timestamp by its captured calendar date in a western timezone', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    expect(formatBatchCalendarDate('2026-11-18T00:00:00.000Z')).toBe('18/11/2026');
  });

  it('shows the manufacturer lot code and clearly marks expired medicine as unavailable for sale', () => {
    const product = { id: 'medicine-vi', name: 'Medicamento VI', expirationMode: 'STRICT', price: 20,
      metadata: { pharmacy: { kind: 'medicine', fraction: 'VI', status: 'confirmed' } } };
    render(<BatchTable {...props(product, [{
      id: 'lot-old', productId: product.id, stock: 0, isActive: true,
      manufacturerBatchId: 'VI-HIST-001', expiryDate: '2000-11-18T00:00:00.000Z'
    }])} />);

    expect(screen.getByText('Lote fabricante VI-HIST-001')).toBeInTheDocument();
    expect(screen.getByText('Vencido · no disponible para venta')).toBeInTheDocument();
    expect(screen.getByText('18/11/2000')).toBeInTheDocument();
  });
});
