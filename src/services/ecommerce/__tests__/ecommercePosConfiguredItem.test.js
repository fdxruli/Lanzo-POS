import { describe, expect, it } from 'vitest';
import {
  reconcileEcommerceConfiguredItem,
  reconcileEcommerceConfiguredItems
} from '../ecommercePosConfiguredItem';

const papas = {
  id: 'prod_rest_papas_francesa',
  name: 'Papas a la francesa',
  price: 45,
  recipe: [
    { ingredientId: 'ing_rest_papa', quantity: 0.25, unit: 'kg' }
  ],
  modifiers: [
    {
      id: 'modgrp_papas_tamano',
      name: 'Tamano',
      required: true,
      options: [
        { id: 'modopt_papas_regular', name: 'Regular', price: 0, tracksInventory: false }
      ]
    },
    {
      id: 'modgrp_papas_extras',
      name: 'Extras',
      required: false,
      options: [
        {
          id: 'modopt_papas_queso',
          name: 'Queso extra',
          price: 12,
          ingredientId: 'ing_rest_queso_oaxaca',
          ingredientQuantity: 0.05,
          ingredientUnit: 'kg',
          tracksInventory: true
        }
      ]
    }
  ]
};

const configuredLine = {
  id: papas.id,
  quantity: 1,
  price: 57,
  ecommerceSnapshotPrice: 57,
  currentPosPrice: 45,
  ecommerceOptions: {
    groups: [
      {
        id: 'public-extras',
        name: 'Extras',
        options: [{ id: 'public-cheese', name: 'Queso extra', priceDelta: 12 }]
      },
      {
        id: 'public-size',
        name: 'Tamano',
        options: [{ id: 'public-regular', name: 'Regular', priceDelta: 0 }]
      }
    ],
    pricing: {
      baseUnitPrice: 45,
      finalUnitPrice: 57,
      optionsAdjustment: 12,
      variantAdjustment: 0
    }
  }
};

describe('ecommerce POS configured item reconciliation', () => {
  it('compares the accepted configured price instead of base price only', () => {
    const result = reconcileEcommerceConfiguredItem({ item: configuredLine, product: papas });

    expect(result.ecommerceConfiguredModifierMappingStatus).toBe('resolved');
    expect(result.ecommerceAcceptedBasePrice).toBe(45);
    expect(result.currentPosPrice).toBe(57);
    expect(result.ecommerceCurrentConfiguredPrice).toBe(57);
  });

  it('maps the public cheese option to the canonical POS modifier and ingredient', () => {
    const result = reconcileEcommerceConfiguredItem({ item: configuredLine, product: papas });

    expect(result.selectedModifiers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'modopt_papas_queso',
        name: 'Queso extra',
        price: 12,
        ingredientId: 'ing_rest_queso_oaxaca',
        ingredientQuantity: 0.05,
        quantity: 0.05,
        tracksInventory: true
      })
    ]));
  });

  it('does not silently accept an option that no longer maps to the POS catalog', () => {
    const result = reconcileEcommerceConfiguredItem({
      item: {
        ...configuredLine,
        ecommerceOptions: {
          ...configuredLine.ecommerceOptions,
          groups: [{
            name: 'Extras',
            options: [{ name: 'Extra inexistente', priceDelta: 12 }]
          }]
        }
      },
      product: papas
    });

    expect(result.ecommerceConfiguredModifierMappingStatus).toBe('conflict');
    expect(result.selectedModifiers).toEqual([]);
    expect(result.ecommerceConfiguredModifierMappingErrors).toContain('OPTION:Extra inexistente');
  });

  it('reconciles only configured lines and preserves simple products', () => {
    const simple = { id: 'simple', name: 'Agua', price: 20 };
    const result = reconcileEcommerceConfiguredItems({
      items: [configuredLine, { ...simple, quantity: 1 }],
      products: [papas, simple]
    });

    expect(result.items[0].currentPosPrice).toBe(57);
    expect(result.items[1]).toEqual({ ...simple, quantity: 1 });
  });
});
