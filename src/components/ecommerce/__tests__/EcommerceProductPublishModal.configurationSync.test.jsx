// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EcommerceProductPublishModal from '../EcommerceProductPublishModal';
import { getEcommercePortal } from '../../../services/ecommerce/ecommerceAdminService';

vi.mock('../../../services/ecommerce/ecommerceAdminService', () => ({
  getEcommercePortal: vi.fn()
}));

const localProduct = {
  id: 'local-configurable',
  name: 'Hamburguesa configurable',
  description: 'Producto local completo',
  price: 80,
  categoryId: 'food',
  trackStock: false,
  recipe: [{ ingredientId: 'bread', quantity: 1, unit: 'pza' }],
  modifiers: [{
    sourceGroupRef: 'extras',
    name: 'Extras',
    selectionType: 'multiple',
    required: true,
    minSelect: 1,
    maxSelect: 2,
    options: [{
      sourceOptionRef: 'cheese',
      name: 'Queso extra',
      priceDelta: 15,
      sourceIngredientId: 'cheese',
      ingredientQuantity: 1,
      ingredientUnit: 'pza',
      tracksInventory: true
    }]
  }]
};

beforeEach(() => {
  vi.clearAllMocks();
  getEcommercePortal.mockResolvedValue({
    success: true,
    features: { stockVisibility: true }
  });
});

afterEach(() => cleanup());

describe('EcommerceProductPublishModal configuration sync handoff', () => {
  it.each([false, true])(
    'hands the selected local product to the domain service for Free/Pro=%s',
    async (isPro) => {
      const onSave = vi.fn().mockResolvedValue(true);
      render(
        <EcommerceProductPublishModal
          open
          editingProduct={null}
          localProducts={[localProduct]}
          categoriesById={new Map([['food', 'Comida']])}
          linkedRefs={new Set()}
          isPro={isPro}
          limitReached={false}
          onClose={vi.fn()}
          onSave={onSave}
        />
      );

      fireEvent.change(screen.getByLabelText(/Producto del catálogo local/), {
        target: { value: localProduct.id }
      });
      fireEvent.click(screen.getByRole('button', { name: 'Guardar producto' }));

      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
        localProductRef: localProduct.id,
        localProduct,
        publicName: localProduct.name,
        price: localProduct.price,
        manualAvailable: true
      }));
    }
  );

  it('does not save when the selected local product cannot be resolved', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(
      <EcommerceProductPublishModal
        open
        editingProduct={{
          id: 'published-missing',
          localProductRef: 'missing-local',
          publicName: 'Missing',
          price: 10,
          isPublished: true,
          manualAvailable: true
        }}
        localProducts={[]}
        categoriesById={new Map()}
        linkedRefs={new Set()}
        isPro={false}
        limitReached={false}
        onClose={vi.fn()}
        onSave={onSave}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Guardar producto' }));
    await waitFor(() => expect(onSave).not.toHaveBeenCalled());
  });
});
