import { describe, expect, it } from 'vitest';
import {
  localSaleToCloudShadowPayload as localSaleToCloudCashierShadowPayload,
  mapLocalCheckoutToCloudSale,
  normalizeSelectedModifierForCloud
} from '../salesCloudCashierMapper';
import {
  localSaleToCloudShadowPayload as localSaleToCloudSyncShadowPayload,
  normalizeSelectedModifierForCloudShadow
} from '../salesCloudMapper';

describe('REST.INV.5 cloud restaurant modifier payloads', () => {
  const sale = {
    id: 'sale-rest-inv-5',
    folio: 'A-1',
    subtotal: 120,
    total: 120,
    paymentMethod: 'cash',
    timestamp: '2026-07-03T12:00:00.000Z',
    orderType: 'restaurant_table'
  };

  const restaurantItem = {
    id: 'prod_hamburguesa',
    parentId: 'prod_hamburguesa',
    lineId: 'line-hamburguesa-1',
    name: 'Hamburguesa',
    quantity: 2,
    price: 60,
    selectedModifiers: [
      {
        id: 'opt_queso_extra',
        optionId: 'opt_queso_extra',
        name: 'Queso extra',
        price: 10,
        ingredientId: 'ing_queso',
        ingredientQuantity: 30,
        ingredientUnit: 'g',
        tracksInventory: true
      },
      {
        id: 'opt_sin_cebolla',
        optionId: 'opt_sin_cebolla',
        name: 'Sin cebolla',
        price: 0,
        tracksInventory: false
      },
      {
        id: 'opt_tocino_legacy',
        optionId: 'opt_tocino_legacy',
        name: 'Tocino extra',
        price: 15,
        ingredientId: 'ing_tocino',
        quantity: 25
      }
    ]
  };

  it('normalizes selected modifiers without losing inventory fields', () => {
    expect(normalizeSelectedModifierForCloud(restaurantItem.selectedModifiers[0])).toMatchObject({
      id: 'opt_queso_extra',
      optionId: 'opt_queso_extra',
      option_id: 'opt_queso_extra',
      name: 'Queso extra',
      price: 10,
      ingredientId: 'ing_queso',
      ingredient_id: 'ing_queso',
      ingredientQuantity: 30,
      ingredient_quantity: 30,
      ingredientUnit: 'g',
      ingredient_unit: 'g',
      tracksInventory: true,
      tracks_inventory: true
    });

    expect(normalizeSelectedModifierForCloud(restaurantItem.selectedModifiers[2])).toMatchObject({
      id: 'opt_tocino_legacy',
      ingredientId: 'ing_tocino',
      quantity: 25
    });

    expect(normalizeSelectedModifierForCloudShadow(restaurantItem.selectedModifiers[0])).toMatchObject({
      id: 'opt_queso_extra',
      ingredientId: 'ing_queso',
      ingredientQuantity: 30,
      tracksInventory: true
    });
  });

  it('sends selected modifiers to the cloud cashier inventory RPC payload', () => {
    const payload = mapLocalCheckoutToCloudSale({
      sale,
      processedItems: [restaurantItem],
      paymentData: { paymentMethod: 'cash', amountPaid: 120 },
      total: 120,
      inventoryEnabled: true
    });

    expect(payload.idempotencyKey).toBe('sales.cloud_commit.inventory:sale-rest-inv-5');
    expect(payload.sale.metadata.phase).toBe('rest_inv_5_cloud_restaurant_inventory');
    expect(payload.items[0].selected_modifiers).toHaveLength(3);
    expect(payload.items[0].selected_modifiers[0]).toMatchObject({
      id: 'opt_queso_extra',
      optionId: 'opt_queso_extra',
      name: 'Queso extra',
      price: 10,
      ingredientId: 'ing_queso',
      ingredientQuantity: 30,
      ingredientUnit: 'g',
      tracksInventory: true
    });
    expect(payload.items[0].metadata.selectedModifiers[2]).toMatchObject({
      id: 'opt_tocino_legacy',
      ingredientId: 'ing_tocino',
      quantity: 25
    });
  });

  it('keeps direct product cloud sales compatible', () => {
    const payload = mapLocalCheckoutToCloudSale({
      sale: { ...sale, id: 'sale-direct' },
      processedItems: [{ id: 'prod_refresco', name: 'Refresco', quantity: 1, price: 25 }],
      paymentData: { paymentMethod: 'cash', amountPaid: 25 },
      total: 25,
      inventoryEnabled: true
    });

    expect(payload.items[0]).toMatchObject({
      product_id: 'prod_refresco',
      product_name: 'Refresco',
      quantity: 1,
      unit_price: 25
    });
    expect(payload.items[0].selected_modifiers).toBeUndefined();
    expect(payload.items[0].metadata.selectedModifiers).toBeUndefined();
  });

  it('preserves selected modifiers in both cloud shadow mappers', () => {
    const cashierShadow = localSaleToCloudCashierShadowPayload({
      ...sale,
      items: [restaurantItem]
    });
    const syncShadow = localSaleToCloudSyncShadowPayload({
      ...sale,
      items: [restaurantItem]
    });

    expect(cashierShadow.items[0].selected_modifiers[0]).toMatchObject({
      id: 'opt_queso_extra',
      ingredientId: 'ing_queso',
      ingredientQuantity: 30,
      tracksInventory: true
    });
    expect(syncShadow.items[0].selected_modifiers[0]).toMatchObject({
      id: 'opt_queso_extra',
      ingredientId: 'ing_queso',
      ingredientQuantity: 30,
      tracksInventory: true
    });
  });
});
