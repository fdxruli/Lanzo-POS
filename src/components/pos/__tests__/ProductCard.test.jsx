import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';

vi.mock('../../common/LazyImage', () => ({
  default: ({ alt }) => <div role="img" aria-label={alt} />
}));

vi.mock('../../common/Logo', () => ({
  LogoMark: ({ className }) => (
    <svg className={className} data-testid="lanzo-product-placeholder" aria-hidden="true" />
  )
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

describe('ProductCard product image placeholder', () => {
  const features = {};
  const baseProduct = {
    id: 'product-2',
    name: 'Cafe molido',
    price: 85,
    stock: 10,
    trackStock: true
  };

  it('shows the Lanzo mark when the product has no assigned image', () => {
    render(
      <ProductCard
        features={features}
        product={{ ...baseProduct, image: '' }}
        onCardClick={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Producto sin foto')).toBeInTheDocument();
    expect(screen.getByTestId('lanzo-product-placeholder')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: baseProduct.name })).not.toBeInTheDocument();
  });

  it('uses the product image when one is assigned', () => {
    render(
      <ProductCard
        features={features}
        product={{ ...baseProduct, image: 'product-image-key' }}
        onCardClick={vi.fn()}
      />
    );

    expect(screen.getByRole('img', { name: baseProduct.name })).toBeInTheDocument();
    expect(screen.queryByLabelText('Producto sin foto')).not.toBeInTheDocument();
  });
});
