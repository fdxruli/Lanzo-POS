import { describe, expect, it, vi } from 'vitest';
import { createEcommercePublishedStockAlertService } from '../ecommercePublishedStockAlertService';
import {
  ecommercePublishedStockLocalSourceInternals
} from '../ecommercePublishedStockLocalSource';

const INGREDIENTS_KEY = ecommercePublishedStockLocalSourceInternals.ENRICHED_INGREDIENTS_KEY;
const NOW = new Date('2026-07-15T12:00:00.000Z');

describe('ecommercePublishedStockAlertService recipe integration', () => {
  it('reemplaza UNVERIFIED por capacidad derivada', async () => {
    const recipeProduct = {
      id: 'burger',
      recipe: [
        { ingredientId: 'pan', quantity: 1, unit: 'pza' },
        { ingredientId: 'carne', quantity: 150, unit: 'g' }
      ],
      [INGREDIENTS_KEY]: [
        { id: 'pan', name: 'Pan', trackStock: true, stock: 20, committedStock: 0, unit: 'pza' },
        { id: 'carne', name: 'Carne', trackStock: true, stock: 1.5, committedStock: 0, unit: 'kg' }
      ]
    };
    const getProductsByIds = vi.fn(async () => new Map([['burger', recipeProduct]]));
    const service = createEcommercePublishedStockAlertService({
      getState: () => ({
        licenseDetails: { license_key: 'license-a' },
        currentDeviceRole: 'admin',
        deviceFingerprint: 'device-a'
      }),
      getPortal: vi.fn(async () => ({
        success: true,
        portal: { id: 'portal-a', status: 'published' }
      })),
      getPublishedProducts: vi.fn(async () => ({
        success: true,
        products: [{
          id: 'published-burger',
          localProductRef: 'burger',
          publicName: 'Hamburguesa',
          isPublished: true
        }]
      })),
      localSource: {
        getProductsByIds,
        getBatchesByProductIds: vi.fn(async () => new Map())
      },
      getNow: () => new Date(NOW)
    });

    const response = await service.evaluatePublishedProductStockAlerts();
    expect(response.products[0]).toMatchObject({
      status: 'in_stock',
      availableStock: 10,
      reasonCode: 'RECIPE_CAPACITY_CALCULATED',
      limitingIngredientId: 'carne',
      limitingIngredientName: 'Carne'
    });
    expect(response.unverifiedCount).toBe(0);
  });

  it('mantiene errores seguros sin exponer costos', async () => {
    const recipeProduct = {
      id: 'burger',
      recipe: [{ ingredientId: 'missing', quantity: 1, unit: 'pza', estimatedCost: 99 }],
      [INGREDIENTS_KEY]: []
    };
    const service = createEcommercePublishedStockAlertService({
      getState: () => ({
        licenseDetails: { license_key: 'license-a' },
        currentDeviceRole: 'admin',
        deviceFingerprint: 'device-a'
      }),
      getPortal: vi.fn(async () => ({ success: true, portal: { status: 'published' } })),
      getPublishedProducts: vi.fn(async () => ({
        success: true,
        products: [{
          id: 'published-burger',
          localProductRef: 'burger',
          publicName: 'Hamburguesa',
          isPublished: true
        }]
      })),
      localSource: {
        getProductsByIds: vi.fn(async () => new Map([['burger', recipeProduct]])),
        getBatchesByProductIds: vi.fn(async () => new Map())
      },
      getNow: () => new Date(NOW)
    });

    const response = await service.evaluatePublishedProductStockAlerts();
    expect(response.products[0]).toMatchObject({
      status: 'unverified',
      reasonCode: 'RECIPE_INGREDIENT_MISSING'
    });
    expect(JSON.stringify(response)).not.toContain('estimatedCost');
    expect(JSON.stringify(response)).not.toContain('99');
  });
});
