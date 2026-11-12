import { fireEvent, render, screen } from '@testing-library/react';
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

describe('ProductCard: mercancía comprometida en POS', () => {
  const base = { id: 'shirt', name: 'Playera negra', price: 100, stock: 2, committedStock: 2, trackStock: true };
  it('distingue dos unidades comprometidas del agotamiento físico y permite consultar con toque y teclado', () => {
    const onCardClick = vi.fn();
    const onBlockedClick = vi.fn();
    render(<ProductCard product={base} features={{}} onCardClick={onCardClick} onBlockedClick={onBlockedClick} />);
    const card = screen.getByRole('button');
    expect(screen.getByText('0 disponibles · 2 comprometidas')).toBeInTheDocument();
    expect(screen.getByText('Comprometido')).toBeInTheDocument();
    expect(card).toHaveAttribute('tabindex', '0');
    fireEvent.click(card);
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });
    expect(onBlockedClick).toHaveBeenCalledTimes(3);
    expect(onCardClick).not.toHaveBeenCalled();
  });
  it('no llama agotado a un producto sin stock verificable', () => {
    const onCardClick = vi.fn(), onBlockedClick = vi.fn();
    render(<ProductCard product={{ ...base, stock: Number.NaN }} features={{}}
      onCardClick={onCardClick} onBlockedClick={onBlockedClick} />);
    expect(screen.getByText('Inventario por verificar')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(onBlockedClick).toHaveBeenCalledOnce();
    expect(onCardClick).not.toHaveBeenCalled();
  });
  it('distingue agotamiento físico y acepta seleccionar al liberarse la reserva', () => {
    const onCardClick = vi.fn(), onBlockedClick = vi.fn();
    const { rerender } = render(<ProductCard product={{ ...base, stock: 0, committedStock: 0 }} features={{}}
      onCardClick={onCardClick} onBlockedClick={onBlockedClick} />);
    expect(screen.getByText('AGOTADO')).toBeInTheDocument();
    rerender(<ProductCard product={{ ...base, committedStock: 0 }} features={{}}
      onCardClick={onCardClick} onBlockedClick={onBlockedClick} />);
    expect(screen.getByText('Stock bajo · 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(onCardClick).toHaveBeenCalledOnce();
    expect(onBlockedClick).not.toHaveBeenCalled();
  });
  it('permite abrir el selector de variantes aunque el total del padre esté comprometido', () => {
    const onCardClick = vi.fn(), onBlockedClick = vi.fn();
    render(<ProductCard product={{ ...base, batchManagement: { enabled: true } }}
      features={{ hasVariants: true }} onCardClick={onCardClick} onBlockedClick={onBlockedClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onCardClick).toHaveBeenCalledOnce();
    expect(onBlockedClick).not.toHaveBeenCalled();
  });
});
