import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';

vi.mock('../../common/LazyImage', () => ({
  default: ({ alt }) => <div role="img" aria-label={alt} />
}));

import ProductCard from '../ProductCard';

describe('ProductCard variant badge', () => {
  const features = { hasVariants: true };
  const product = {
    id: 'product-1',
    name: 'Playera',
    price: 150,
    stock: 5,
    trackStock: true,
    batchManagement: { enabled: true }
  };

  it('does not show the variant badge for a generic stock batch', () => {
    render(
      <ProductCard
        features={features}
        product={product}
        onCardClick={vi.fn()}
        hasAvailableVariants={false}
      />
    );

    expect(screen.queryByText('Variantes')).not.toBeInTheDocument();
  });

  it('shows the variant badge when a real variant is available', () => {
    render(
      <ProductCard
        features={features}
        product={product}
        onCardClick={vi.fn()}
        hasAvailableVariants
      />
    );

    expect(screen.getByText('Variantes')).toBeInTheDocument();
  });
});
