// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';

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

  it('keeps the variant product reference separate from its cart line id', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const { container } = render(
      <VariantSelectorModal
        show
        onClose={vi.fn()}
        product={product}
        onConfirm={onConfirm}
        preloadedBatches={[
          { id: 'batch-m', isActive: true, stock: 3, price: 160, cost: 80, sku: 'PLAYERA-M', attributes: { talla: 'M', color: 'Negro' } }
        ]}
      />
    );

    await user.click(container.querySelector('.size-card'));

    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      id: 'product-1',
      parentId: 'product-1',
      productId: 'product-1',
      lineId: expect.any(String),
      batchId: 'batch-m'
    }));
  });
});
