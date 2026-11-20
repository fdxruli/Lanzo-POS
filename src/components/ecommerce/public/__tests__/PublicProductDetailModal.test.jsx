// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PublicProductDetailModal from '../PublicProductDetailModal';

const product = {
  id: 'simple-product',
  name: 'Café de olla',
  categoryName: 'Bebidas',
  description: 'Café molido con canela.\nPresentación de 500 gramos.',
  price: 125,
  currency: 'MXN',
  imageUrl: '',
  isAvailable: true,
  stock: { mode: 'exact', status: 'available', quantity: 3 },
  wholesaleEnabled: true,
  wholesaleTiers: [{ sourceTierRef: 'min:2', minQuantity: 2, unitPrice: 110 }]
};

const renderDetail = (props = {}) => render(
  <PublicProductDetailModal
    product={product}
    maxItemQuantity={5}
    maxOrderItems={5}
    cartItems={[]}
    onAdd={vi.fn(() => true)}
    onClose={vi.fn()}
    {...props}
  />
);

describe('PublicProductDetailModal', () => {
  afterEach(() => {
    cleanup();
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
  });

  it('shows the full available product information and submits an explicit quantity', () => {
    const onAdd = vi.fn(() => true);
    renderDetail({ onAdd });

    expect(screen.getByRole('heading', { name: 'Café de olla' })).toBeInTheDocument();
    expect(screen.getByText('Bebidas')).toBeInTheDocument();
    expect(screen.getByText(/Presentación de 500 gramos/)).toBeInTheDocument();
    expect(screen.getByText('$125.00')).toBeInTheDocument();
    expect(screen.getByText('2 o más')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Café de olla sin imagen' })).toHaveClass('public-safe-image--fallback');

    fireEvent.click(screen.getByRole('button', { name: 'Aumentar cantidad de Café de olla' }));
    fireEvent.click(screen.getByRole('button', { name: 'Aumentar cantidad de Café de olla' }));
    expect(screen.getByRole('spinbutton', { name: 'Cantidad de Café de olla' })).toHaveValue(3);
    fireEvent.click(screen.getByRole('button', { name: 'Agregar al carrito' }));
    expect(onAdd).toHaveBeenCalledWith(product, { quantity: 3 });
  });

  it('limits the selected add quantity to exact inventory and the shop maximum', () => {
    const onAdd = vi.fn(() => true);
    renderDetail({ onAdd, maxItemQuantity: 2 });

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Cantidad de Café de olla' }), {
      target: { value: '9' }
    });
    expect(screen.getByRole('spinbutton', { name: 'Cantidad de Café de olla' })).toHaveValue(2);
    fireEvent.click(screen.getByRole('button', { name: 'Agregar al carrito' }));
    expect(onAdd).toHaveBeenCalledWith(product, { quantity: 2 });
  });

  it('accounts for stock already in the cart and blocks an unavailable product', () => {
    const onAdd = vi.fn();
    const cartItems = [{ product, quantity: 2 }];
    const { rerender } = renderDetail({ onAdd, cartItems });

    expect(screen.getByRole('spinbutton', { name: 'Cantidad de Café de olla' })).toHaveAttribute('max', '1');
    fireEvent.click(screen.getByRole('button', { name: 'Agregar al carrito' }));
    expect(onAdd).toHaveBeenCalledWith(product, { quantity: 1 });

    const soldOutProduct = {
      ...product,
      stock: { mode: 'exact', status: 'out_of_stock', quantity: 0 }
    };
    rerender(
      <PublicProductDetailModal
        product={soldOutProduct}
        maxItemQuantity={5}
        maxOrderItems={5}
        cartItems={[]}
        onAdd={onAdd}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Agotado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No disponible' })).toBeDisabled();
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('shows an empty description safely and enforces the distinct line limit', () => {
    const onAdd = vi.fn();
    const otherLine = { product: { id: 'other' }, quantity: 1 };
    renderDetail({
      product: { ...product, description: '', imageUrl: 'javascript:alert(1)' },
      cartItems: [otherLine],
      maxOrderItems: 1,
      onAdd
    });

    expect(screen.queryByText('Presentación de 500 gramos.')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Café de olla sin imagen' })).toHaveClass('public-safe-image--fallback');
    expect(screen.getByRole('button', { name: 'Agregar al carrito' })).toBeDisabled();
    expect(screen.getByText(/máximo de 1 producto distinto/)).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('closes with Escape, restores scroll and returns focus to the trigger', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    document.body.style.overflow = 'auto';
    const onClose = vi.fn();
    const removeListener = vi.spyOn(window, 'removeEventListener');
    const view = renderDetail({ returnFocusElement: trigger, onClose });
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    view.unmount();

    expect(document.body.style.overflow).toBe('auto');
    expect(document.activeElement).toBe(trigger);
    expect(removeListener).toHaveBeenCalledWith('keydown', expect.any(Function));
    removeListener.mockRestore();
    trigger.remove();
  });

  it('closes when the backdrop is pressed', () => {
    const onClose = vi.fn();
    const { container } = renderDetail({ onClose });
    fireEvent.click(container.querySelector('.public-product-detail-modal__backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps keyboard focus inside the detail dialog', () => {
    const { container } = renderDetail();
    const dialog = screen.getByRole('dialog');
    const closeButton = dialog.querySelector('.public-icon-button');
    const addButton = screen.getByRole('button', { name: 'Agregar al carrito' });

    addButton.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement).toBe(closeButton);

    closeButton.focus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(addButton);
    expect(container.querySelector('.public-product-detail')).toBeInTheDocument();
  });
});
