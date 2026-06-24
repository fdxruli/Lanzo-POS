import { syncConflictService } from '../sync/syncConflictService';
import { SYNC_ENTITY_TYPES } from '../sync/syncConstants';
import { productLocalRepository } from './productLocalRepository';

export const PRODUCT_CONFLICT_CODES = new Set([
  'VERSION_CONFLICT',
  'DUPLICATE_PRODUCT_KEY',
  'DUPLICATE_SKU',
  'DUPLICATE_BARCODE',
  'DUPLICATE_CATEGORY_NAME',
  'CATEGORY_DELETED',
  'PRODUCT_DELETED',
  'PRODUCT_NOT_FOUND',
  'BATCH_NOT_FOUND',
  'BATCH_PRODUCT_MISMATCH',
  'STRICT_EXPIRY_REQUIRED'
]);

const entityTypeFromOperation = (operation = {}, response = {}) => {
  if (operation.entityType) return operation.entityType;
  if (response.category) return SYNC_ENTITY_TYPES.CATEGORY;
  if (response.batch) return SYNC_ENTITY_TYPES.PRODUCT_BATCH;
  return SYNC_ENTITY_TYPES.PRODUCT;
};

const entityIdFromOperation = (operation = {}, response = {}) => (
  operation.entityId ||
  response?.category?.id ||
  response?.product?.id ||
  response?.batch?.id ||
  'unknown'
);

export const productConflictService = {
  isConflictResponse(response = {}) {
    return response?.success === false && PRODUCT_CONFLICT_CODES.has(response.code);
  },

  normalizeFailure(response = {}, fallback = 'PRODUCT_SYNC_FAILED') {
    const code = response?.code || fallback;
    return {
      success: false,
      code,
      message: response?.message || code,
      field: response?.field || null,
      response,
      error: {
        code,
        message: response?.message || code,
        details: response
      }
    };
  },

  async saveConflict({ operation = {}, response = {}, localPayload = null, source = 'productConflictService' }) {
    const entityType = entityTypeFromOperation(operation, response);
    const entityId = entityIdFromOperation(operation, response);
    const conflictType = response?.code || 'PRODUCT_SYNC_CONFLICT';

    const conflict = await syncConflictService.saveConflict({
      entityType,
      entityId,
      conflictType,
      localPayload: localPayload || operation?.payload || operation || null,
      serverPayload: response?.category || response?.product || response?.batch || response || null,
      metadata: {
        source,
        outboxId: operation?.id || null
      }
    });

    if (entityId !== 'unknown') {
      await productLocalRepository.markConflict({ entityType, entityId, reason: conflictType });
    }

    return conflict;
  }
};

export default productConflictService;
