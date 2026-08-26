import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => {
  class TestActorRuntimeError extends Error {
    constructor(code, details = {}) {
      super(code);
      this.code = code;
      this.details = details;
    }
  }
  return {
    current: null,
    assertGranted: vi.fn(),
    capture: vi.fn(),
    TestActorRuntimeError
  };
});

vi.mock('../actorRuntimeController', () => ({
  ACTOR_RUNTIME_ERROR_CODES: {
    CONTEXT_LOCKED: 'ACTOR_CONTEXT_LOCKED',
    CONTEXT_STALE: 'ACTOR_CONTEXT_STALE',
    TENANT_MISMATCH: 'ACTOR_TENANT_MISMATCH',
    PERMISSION_DENIED: 'ACTOR_PERMISSION_DENIED'
  },
  ActorRuntimeError: runtime.TestActorRuntimeError,
  actorRuntimeController: runtime
}));
import {
  getProductInventoryMutationRequirements,
  assertProductInventoryOperationActorCurrent,
  PRODUCT_PERMISSION,
  INVENTORY_PERMISSION
} from '../productInventoryAuthority';
import { SYNC_ENTITY_TYPES, SYNC_OPERATIONS } from '../../sync/syncConstants';

const requirements = (entityType, operation, payload) => getProductInventoryMutationRequirements({
  entityType,
  operation,
  payload
});

const actorOrigin = (overrides = {}) => ({
  actorType: 'staff',
  actorId: 'staff-a',
  actorKey: 'staff:staff-a',
  generation: 3,
  tenant: { opaqueId: 'tenant-a', databaseName: 'LanzoDB_tenant-a', generation: 1 },
  permissions: ['products', 'inventory'],
  status: 'granted',
  ...overrides
});

const operationWithOrigin = (entityType, overrides = {}) => ({
  entityType,
  operation: SYNC_OPERATIONS.UPDATE,
  actorSensitivity: 'actor_bound',
  originActorKey: 'staff:staff-a',
  originActorGeneration: 3,
  ...overrides
});

const installRuntime = (overrides = {}) => {
  runtime.current = actorOrigin(overrides);
  runtime.assertGranted.mockImplementation((permission = null) => {
    if (runtime.current.status !== 'granted') {
      throw new runtime.TestActorRuntimeError('ACTOR_CONTEXT_LOCKED');
    }
    if (runtime.current.tenantValid === false) {
      throw new runtime.TestActorRuntimeError('ACTOR_TENANT_MISMATCH');
    }
    if (
      permission
      && !runtime.current.permissions.includes('*')
      && !runtime.current.permissions.includes(permission)
    ) {
      throw new runtime.TestActorRuntimeError('ACTOR_PERMISSION_DENIED', { permission });
    }
    return runtime.current;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  installRuntime();
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

  it('accepts complete product and inventory origins only for the current actor generation', () => {
    expect(assertProductInventoryOperationActorCurrent(operationWithOrigin(SYNC_ENTITY_TYPES.PRODUCT))).toBe(runtime.current);
    expect(assertProductInventoryOperationActorCurrent(operationWithOrigin(SYNC_ENTITY_TYPES.INVENTORY_ENTRY))).toBe(runtime.current);
    expect(runtime.assertGranted).toHaveBeenCalledWith('products');
    expect(runtime.assertGranted).toHaveBeenCalledWith('inventory');
  });

  it.each([
    ['actor switch', { actorKey: 'staff:staff-b', actorId: 'staff-b' }],
    ['generation stale', { generation: 4 }]
  ])('rejects a product replay after %s', (_label, current) => {
    installRuntime(current);

    expect(() => assertProductInventoryOperationActorCurrent(
      operationWithOrigin(SYNC_ENTITY_TYPES.PRODUCT)
    )).toThrowError(expect.objectContaining({ code: 'ACTOR_CONTEXT_STALE' }));
  });

  it('rejects product replay after products permission revocation', () => {
    installRuntime({ permissions: ['inventory'] });

    expect(() => assertProductInventoryOperationActorCurrent(
      operationWithOrigin(SYNC_ENTITY_TYPES.PRODUCT)
    )).toThrowError(expect.objectContaining({ code: 'ACTOR_PERMISSION_DENIED' }));
  });

  it('rejects inventory replay after inventory permission revocation', () => {
    installRuntime({ permissions: ['products'] });

    expect(() => assertProductInventoryOperationActorCurrent(
      operationWithOrigin(SYNC_ENTITY_TYPES.INVENTORY_ENTRY)
    )).toThrowError(expect.objectContaining({ code: 'ACTOR_PERMISSION_DENIED' }));
  });

  it('rejects replay when the tenant runtime no longer matches', () => {
    installRuntime({ tenantValid: false });

    expect(() => assertProductInventoryOperationActorCurrent(
      operationWithOrigin(SYNC_ENTITY_TYPES.PRODUCT)
    )).toThrowError(expect.objectContaining({ code: 'ACTOR_TENANT_MISMATCH' }));
  });

  it('fails closed when the actor session is no longer valid', () => {
    installRuntime({ status: 'locked' });

    expect(() => assertProductInventoryOperationActorCurrent(
      operationWithOrigin(SYNC_ENTITY_TYPES.INVENTORY_ENTRY)
    )).toThrowError(expect.objectContaining({ code: 'ACTOR_CONTEXT_LOCKED' }));
  });
});
