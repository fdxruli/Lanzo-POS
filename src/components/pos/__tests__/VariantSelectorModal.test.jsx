// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

const loadBatchesForProductMock = vi.hoisted(() => vi.fn(async () => []));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: vi.fn((selector) => selector({ companyProfile: { business_type: 'apparel' } }))
}));

vi.mock('../../../hooks/useInventoryMovement', () => ({
  useInventoryMovement: () => ({
    loadBatchesForProduct: loadBatchesForProductMock
  })
}));

import VariantSelectorModal from '../VariantSelectorModal';

describe('VariantSelectorModal', () => {
  const product = {
    id: 'product-1',
    name: 'Playera',
    price: 150
  };

  it('does not render UNIT for a generic initial-stock batch', () => {
    render(
      <VariantSelectorModal
        show
        onClose={vi.fn()}
        product={product}
        onConfirm={vi.fn()}
        preloadedBatches={[
          {
            id: 'generic',
            isActive: true,
            stock: 5,
            price: 150,
            cost: 80,
            attributes: null
          }
        ]}
      />
    );

    expect(screen.getByText(/No hay variantes disponibles con stock/i)).toBeInTheDocument();
    expect(screen.queryByText('UNIT')).not.toBeInTheDocument();
  });

  it('adds a textual stock state for low and critical variants', () => {
    render(
      <VariantSelectorModal
        show
        onClose={vi.fn()}
        product={product}
        onConfirm={vi.fn()}
        preloadedBatches={[
          { id: 'critical', isActive: true, stock: 2, price: 150, cost: 80, attributes: { talla: 'S', color: 'Negro' } },
          { id: 'low', isActive: true, stock: 4, price: 150, cost: 80, attributes: { talla: 'M', color: 'Negro' } }
        ]}
      />
    );

    expect(screen.getByText(/2 disponibles · Stock crítico/i)).toBeInTheDocument();
    expect(screen.getByText(/4 disponibles · Stock bajo/i)).toBeInTheDocument();
  });
});
