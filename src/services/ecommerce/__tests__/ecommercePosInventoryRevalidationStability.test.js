import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  state: null,
  revalidateRecipeInventory: vi.fn()
}));

vi.mock('../../../hooks/pos/useActiveOrders', () => ({
  useActiveOrders: {
    getState: () => mocks.state
  }
}));

vi.mock('../ecommercePosInventoryResolutionRecipeBase', () => ({
  revalidateEcommerceDraftInventory: mocks.revalidateRecipeInventory
}));

import { revalidateEcommerceDraftInventory } from '../ecommercePosInventoryResolution';

const ORDER_ID = 'ecom-order-1';
const firstResolvedAt = '2026-07-16T18:57:15.000Z';
const secondResolvedAt = '2026-07-16T18:58:47.000Z';

const buildOrder = ({
  resolvedAt = firstResolvedAt,
  inventoryStatus = 'ready',
  lineStatus = 'resolved',
  code = null,
  requiredQuantity = 1,
  needsInventoryResolution = false,
  revision = 1,
  updatedAt = firstResolvedAt
} = {}) => ({
  id: ORDER_ID,
  origin: 'ecommerce',
  revision,
  updatedAt,
  ecommerceInventoryStatus: inventoryStatus,
  ecommerceInventoryConflictCount: inventoryStatus === 'conflict' ? 1 : 0,
  ecommerceInventoryResolutionVersion: 2,
  ecommerceInventoryResolvedAt: inventoryStatus === 'ready' ? resolvedAt : null,
  ecommerceInventoryError: null,
  items: [{
    id: 'papas',
    lineId: 'line-papas',
    quantity: 1,
    price: 57,
    selectedModifiers: [{ id: 'queso', price: 12 }],
    needsInventoryResolution,
    inventoryResolution: {
      mode: 'recipe',
      status: lineStatus,
      code,
      requestedSaleQuantity: 1,
      requiredInventoryQuantity: requiredQuantity,
      requestedQuantity: requiredQuantity,
      batchId: null,
      selectionMode: 'recipe_ingredients',
      resolvedAt: inventoryStatus === 'ready' ? resolvedAt : null
    }
  }]
});

beforeEach(() => {
  vi.clearAllMocks();
  const initial = buildOrder();
  mocks.state = {
    activeOrders: new Map([[ORDER_ID, initial]]),
    updateOrder: vi.fn((orderId, patch) => {
      const current = mocks.state.activeOrders.get(orderId);
      mocks.state.activeOrders.set(orderId, {
        ...current,
        ...patch,
        revision: Number(current.revision || 0) + 1,
        updatedAt: secondResolvedAt
      });
    })
  };
});

describe('ecommerce POS inventory revalidation stability', () => {
  it('preserves the accepted inventory timestamp when the recipe result is semantically identical', async () => {
    mocks.revalidateRecipeInventory.mockImplementation(async () => {
      const next = buildOrder({
        resolvedAt: secondResolvedAt,
        revision: 2,
        updatedAt: secondResolvedAt
      });
      mocks.state.activeOrders.set(ORDER_ID, next);
      return {
        success: true,
        changed: true,
        order: next,
        resolution: {
          items: next.items,
          ecommerceInventoryStatus: next.ecommerceInventoryStatus,
          ecommerceInventoryResolvedAt: next.ecommerceInventoryResolvedAt
        }
      };
    });

    const result = await revalidateEcommerceDraftInventory({ orderId: ORDER_ID });
    const stored = mocks.state.activeOrders.get(ORDER_ID);

    expect(result.success).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.order.ecommerceInventoryResolvedAt).toBe(firstResolvedAt);
    expect(result.order.items[0].inventoryResolution.resolvedAt).toBe(firstResolvedAt);
    expect(result.resolution.ecommerceInventoryResolvedAt).toBe(firstResolvedAt);
    expect(stored.ecommerceInventoryResolvedAt).toBe(firstResolvedAt);
    expect(stored.items[0].inventoryResolution.resolvedAt).toBe(firstResolvedAt);
  });

  it('keeps the new state when inventory semantics actually changed', async () => {
    mocks.revalidateRecipeInventory.mockImplementation(async () => {
      const next = buildOrder({
        resolvedAt: secondResolvedAt,
        inventoryStatus: 'conflict',
        lineStatus: 'conflict',
        code: 'INSUFFICIENT_RECIPE_STOCK',
        requiredQuantity: 2,
        needsInventoryResolution: true,
        revision: 2,
        updatedAt: secondResolvedAt
      });
      mocks.state.activeOrders.set(ORDER_ID, next);
      return { success: true, changed: true, order: next };
    });

    const result = await revalidateEcommerceDraftInventory({ orderId: ORDER_ID });

    expect(result.changed).toBe(true);
    expect(result.order.ecommerceInventoryStatus).toBe('conflict');
    expect(result.order.items[0].inventoryResolution.code).toBe('INSUFFICIENT_RECIPE_STOCK');
    expect(result.order.items[0].inventoryResolution.requiredInventoryQuantity).toBe(2);
  });
});