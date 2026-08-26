import { describe, expect, it } from 'vitest';
import {
  getProductInventoryMutationRequirements,
  PRODUCT_PERMISSION,
  INVENTORY_PERMISSION
} from '../productInventoryAuthority';
import { SYNC_ENTITY_TYPES, SYNC_OPERATIONS } from '../../sync/syncConstants';

const requirements = (entityType, operation, payload) => getProductInventoryMutationRequirements({
  entityType,
  operation,
  payload
});

describe('product/inventory authority matrix', () => {
  it('keeps catalog metadata independent from inventory', () => {
    expect(requirements(SYNC_ENTITY_TYPES.CATEGORY, SYNC_OPERATIONS.UPDATE, {})).toEqual([PRODUCT_PERMISSION]);
    expect(requirements(SYNC_ENTITY_TYPES.PRODUCT, SYNC_OPERATIONS.UPSERT, {
      isNewProduct: true,
      product: { stock: 0, committed_stock: 0 },
      initialBatches: []
    })).toEqual([PRODUCT_PERMISSION]);
    expect(requirements(SYNC_ENTITY_TYPES.PRODUCT, SYNC_OPERATIONS.UPSERT, {
      isNewProduct: false,
      product: { stock: 42, committed_stock: 3 },
      initialBatches: []
    })).toEqual([PRODUCT_PERMISSION]);
  });

  it('requires both permissions for initial stock and product deletion', () => {
    expect(requirements(SYNC_ENTITY_TYPES.PRODUCT, SYNC_OPERATIONS.UPSERT, {
      isNewProduct: true,
      product: { stock: 5 },
      initialBatches: []
    })).toEqual([PRODUCT_PERMISSION, INVENTORY_PERMISSION]);
    expect(requirements(SYNC_ENTITY_TYPES.PRODUCT, SYNC_OPERATIONS.UPSERT, {
      isNewProduct: true,
      product: { stock: 0 },
      initialBatches: [{ id: 'batch-1', stock: 0 }]
    })).toEqual([PRODUCT_PERMISSION, INVENTORY_PERMISSION]);
    expect(requirements(SYNC_ENTITY_TYPES.PRODUCT, SYNC_OPERATIONS.DELETE, {})).toEqual([
      PRODUCT_PERMISSION,
      INVENTORY_PERMISSION
    ]);
  });

  it('keeps standalone inventory operations independent', () => {
    expect(requirements(SYNC_ENTITY_TYPES.PRODUCT_BATCH, SYNC_OPERATIONS.UPSERT, {})).toEqual([INVENTORY_PERMISSION]);
    expect(requirements(SYNC_ENTITY_TYPES.INVENTORY_ENTRY, SYNC_OPERATIONS.INVENTORY_ENTRY, {})).toEqual([INVENTORY_PERMISSION]);
  });
});