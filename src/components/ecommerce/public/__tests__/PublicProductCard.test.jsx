// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PublicProductCard from '../PublicProductCard';

const product = {
  id: 'simple-product',
  name: 'Producto sencillo',
  categoryName: 'General',
  description: 'Descripción del producto',
  price: 125,
  currency: 'MXN',
  imageUrl: ''
};

const renderCard = (props = {}) => render(
  <PublicProductCard
    product={product}
    isConfigurable={false}
    isAvailable
    stockLabel={null}
    onPrimaryAction={vi.fn()}
    {...props}
  />
);

describe('PublicProductCard', () => {
  afterEach(cleanup);

  it('renders a simple product without a router and reports its primary action', () => {
    const onPrimaryAction = vi.fn();
    renderCard({ onPrimaryAction });

    expect(screen.getByRole('heading', { name: 'Producto sencillo' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Producto sencillo sin imagen' })).toHaveClass(
      'public-product-card__image',
      'public-safe-image--fallback'
    );
    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.getByText('Descripción del producto')).toBeInTheDocument();
    expect(screen.getByText('$125.00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Agregar Producto sencillo' }));
    expect(onPrimaryAction).toHaveBeenCalledWith(product);
  });

  it('renders configurable product pricing and wholesale tiers', () => {
    const configurableProduct = {
      ...product,
      wholesaleEnabled: true,
      wholesaleTiers: [{ sourceTierRef: 'tier-1', minQuantity: 6, unitPrice: 110 }]
    };
    renderCard({ product: configurableProduct, isConfigurable: true, stockLabel: 'Disponible' });

    expect(screen.getByText('Desde $125.00')).toBeInTheDocument();
    expect(screen.getByText('Compra 6 o más: $110.00 c/u')).toBeInTheDocument();
    expect(screen.getByText('Disponible')).toHaveClass('public-product-card__stock');
    expect(screen.getByRole('button', { name: 'Seleccionar opciones Producto sencillo' })).toBeEnabled();
  });

  it('keeps unavailable products disabled and marks their stock state', () => {
    const onPrimaryAction = vi.fn();
    renderCard({ isAvailable: false, stockLabel: 'Agotado', onPrimaryAction });

    const button = screen.getByRole('button', { name: 'Producto sencillo no disponible' });
    expect(button).toBeDisabled();
    expect(screen.getByText('Agotado')).toHaveClass('public-product-card__stock', 'is-unavailable');
    fireEvent.click(button);
    expect(onPrimaryAction).not.toHaveBeenCalled();
  });
});
