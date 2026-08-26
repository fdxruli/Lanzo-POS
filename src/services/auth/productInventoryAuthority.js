import {
  ACTOR_RUNTIME_ERROR_CODES,
  ActorRuntimeError,
  actorRuntimeController
} from './actorRuntimeController';
import { SYNC_ENTITY_TYPES, SYNC_OPERATIONS } from '../sync/syncConstants';

export const PRODUCT_PERMISSION = 'products';
export const INVENTORY_PERMISSION = 'inventory';

const uniqueRequirements = (requirements = []) => [...new Set(requirements)];

const hasInitialBatches = (payload = {}) => (
  Array.isArray(payload?.initialBatches) && payload.initialBatches.length > 0
);

export const hasInitialProductStock = (product = {}) => (
  [product?.stock, product?.committedStock, product?.committed_stock]
    .some((value) => Number.isFinite(Number(value)) && Number(value) > 0)
);

export const getProductInventoryMutationRequirements = ({
  entityType,
  operation,
  payload = {}
} = {}) => {
  if (entityType === SYNC_ENTITY_TYPES.CATEGORY) return [PRODUCT_PERMISSION];
  if (entityType === SYNC_ENTITY_TYPES.PRODUCT_BATCH) return [INVENTORY_PERMISSION];
  if (entityType === SYNC_ENTITY_TYPES.INVENTORY_ENTRY) return [INVENTORY_PERMISSION];

  if (entityType === SYNC_ENTITY_TYPES.PRODUCT) {
    if (operation === SYNC_OPERATIONS.DELETE) {
      return [PRODUCT_PERMISSION, INVENTORY_PERMISSION];
    }
    const isNewProduct = payload?.isNewProduct === true
      || operation === SYNC_OPERATIONS.CREATE
      || operation === 'created';
    return uniqueRequirements([
      PRODUCT_PERMISSION,
      ...(hasInitialBatches(payload) || (isNewProduct && hasInitialProductStock(payload?.product))
        ? [INVENTORY_PERMISSION]
        : [])
    ]);
  }

  return [];
};

export const captureProductInventoryMutation = (requirements = {}) => {
  const handle = actorRuntimeController.capture();
  for (const permission of uniqueRequirements([
    ...(requirements.products ? [PRODUCT_PERMISSION] : []),
    ...(requirements.inventory ? [INVENTORY_PERMISSION] : [])
  ])) {
    handle.assertCurrent(permission);
  }
  return handle;
};

export const assertProductInventoryMutationCurrent = (handle, requirements = {}) => {
  if (!handle || typeof handle.assertCurrent !== 'function') {
    throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.CONTEXT_STALE, {
      reason: 'product_inventory_actor_handle_missing'
    });
  }

  handle.assertCurrent();
  for (const permission of uniqueRequirements([
    ...(requirements.products ? [PRODUCT_PERMISSION] : []),
    ...(requirements.inventory ? [INVENTORY_PERMISSION] : [])
  ])) {
    handle.assertCurrent(permission);
  }
  return true;
};

export const actorOriginFromHandle = (handle) => {
  if (!handle?.actorKey) {
    throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.CONTEXT_STALE, {
      reason: 'product_inventory_actor_origin_missing'
    });
  }
  return {
    actorType: handle.actorType,
    actorId: handle.actorId,
    actorKey: handle.actorKey,
    actorGeneration: handle.generation
  };
};

export const assertProductInventoryOperationActorCurrent = (operation = {}) => {
  const requirements = getProductInventoryMutationRequirements(operation);
  if (requirements.length === 0) return null;

  const originActorKey = operation.originActorKey;
  const originGeneration = Number(operation.originActorGeneration);
  if (
    operation.actorSensitivity !== 'actor_bound'
    || typeof originActorKey !== 'string'
    || originActorKey.length === 0
    || !Number.isFinite(originGeneration)
  ) {
    throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.CONTEXT_STALE, {
      reason: 'product_inventory_outbox_actor_origin_unresolved',
      entityType: operation.entityType || null,
      entityId: operation.entityId || null
    });
  }

  const current = actorRuntimeController.assertGranted();
  if (current.actorKey !== originActorKey || current.generation !== originGeneration) {
    throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.CONTEXT_STALE, {
      reason: 'product_inventory_outbox_actor_context_stale',
      originActorKey,
      originGeneration,
      currentActorKey: current.actorKey,
      currentGeneration: current.generation
    });
  }

  for (const permission of requirements) {
    actorRuntimeController.assertGranted(permission);
  }
  return current;
};
