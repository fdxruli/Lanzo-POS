// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EcommerceProductPublishModal from '../EcommerceProductPublishModal';
import { getEcommercePortal } from '../../../services/ecommerce/ecommerceAdminService';

vi.mock('../../../services/ecommerce/ecommerceAdminService', () => ({
  getEcommercePortal: vi.fn()
}));

const trackedProduct = {
  id: 'product-1',
  name: 'Producto local',
  description: 'Descripción',
  price: 50,
  categoryId: 'category-1',
  trackStock: true,
  imageUrl: 'https://example.com/product.jpg'
};

const renderModal = ({
  isPro = true,
  editingProduct = null,
  localProducts = [trackedProduct],
  onSave = vi.fn().mockResolvedValue(true)
} = {}) => {
  const onClose = vi.fn();
  render(
    <EcommerceProductPublishModal
      open
      editingProduct={editingProduct}
      localProducts={localProducts}
      categoriesById={new Map([['category-1', 'General']])}
      linkedRefs={new Set()}
      isPro={isPro}
      limitReached={false}
      onClose={onClose}
      onSave={onSave}
    />
  );
  return { onSave, onClose };
};

const chooseLocalProduct = () => {
  fireEvent.change(screen.getByLabelText(/Producto del catálogo local/), {
    target: { value: 'product-1' }
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  getEcommercePortal.mockResolvedValue({
    success: true,
    features: { stockVisibility: true }
  });
});

afterEach(() => cleanup());

describe('EcommerceProductPublishModal stock visibility', () => {
  it('forces hidden for FREE and does not expose the selector', async () => {
    const { onSave } = renderModal({ isPro: false });
    chooseLocalProduct();

    expect(screen.queryByLabelText(/Visibilidad del inventario/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar producto' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      stockMode: 'hidden'
    })));
    expect(getEcommercePortal).not.toHaveBeenCalled();
  });

  it('allows PRO to save status visibility when the server feature is enabled', async () => {
    const { onSave } = renderModal();
    chooseLocalProduct();

    const selector = await screen.findByLabelText(/Visibilidad del inventario/);
    await waitFor(() => expect(selector.disabled).toBe(false));
    fireEvent.change(selector, { target: { value: 'status' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar producto' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      stockMode: 'status'
    })));
  });

  it('allows PRO to save exact visibility when stock is tracked', async () => {
    const { onSave } = renderModal();
    chooseLocalProduct();

    const selector = await screen.findByLabelText(/Visibilidad del inventario/);
    await waitFor(() => expect(selector.disabled).toBe(false));
    fireEvent.change(selector, { target: { value: 'exact' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar producto' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      stockMode: 'exact'
    })));
  });

  it('forces hidden when the server feature is disabled', async () => {
    getEcommercePortal.mockResolvedValue({
      success: true,
      features: { stockVisibility: false }
    });
    const { onSave } = renderModal();
    chooseLocalProduct();

    const selector = await screen.findByLabelText(/Visibilidad del inventario/);
    await waitFor(() => expect(selector.disabled).toBe(true));
    expect(selector.value).toBe('hidden');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar producto' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      stockMode: 'hidden'
    })));
  });

  it('forces hidden for not_tracked products', async () => {
    const { onSave } = renderModal({
      localProducts: [{ ...trackedProduct, trackStock: false }]
    });
    chooseLocalProduct();

    const selector = await screen.findByLabelText(/Visibilidad del inventario/);
    await waitFor(() => expect(selector.disabled).toBe(true));
    expect(selector.value).toBe('hidden');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar producto' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      stockMode: 'hidden'
    })));
  });

  it('loads and preserves the existing stock mode while editing', async () => {
    renderModal({
      editingProduct: {
        id: 'published-1',
        localProductRef: 'product-1',
        publicName: 'Producto publicado',
        publicDescription: 'Descripción',
        price: 50,
        categoryName: 'General',
        manualAvailable: true,
        isPublished: true,
        displayOrder: 0,
        stockMode: 'exact',
        sourceState: 'in_stock',
        syncConfig: {
          name: 'source',
          description: 'manual',
          category: 'source',
          price: 'source',
          image: 'manual'
        }
      }
    });

    const selector = await screen.findByLabelText(/Visibilidad del inventario/);
    await waitFor(() => {
      expect(selector.disabled).toBe(false);
      expect(selector.value).toBe('exact');
    });
  });

  it('blocks saving when the server feature cannot be validated', async () => {
    getEcommercePortal.mockRejectedValue(new Error('network failed'));
    const { onSave } = renderModal({
      editingProduct: {
        id: 'published-1',
        localProductRef: 'product-1',
        publicName: 'Producto publicado',
        price: 50,
        manualAvailable: true,
        isPublished: true,
        stockMode: 'exact',
        sourceState: 'in_stock'
      }
    });

    expect(await screen.findByText(/No se pudo validar la política de inventario/)).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Guardar producto' }).disabled).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
  });
});
