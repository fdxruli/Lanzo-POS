import { db, STORES } from '../db/dexie';
import {
  createProductWithInitialInventorySafe,
  loadData,
  loadDataPaginated,
  saveBatchAndSyncProductSafe,
  saveImageToDB,
  softDeleteWithCascadeSafe,
  updateProductSafe
} from '../database';
import { categoriesRepository } from '../db/general';
import { generateID } from '../utils';
import { calculateShelfLifeTargetDate } from '../../utils/expirationPolicy';
import {
  cloudBatchToLocal,
  cloudCategoryToLocal,
  cloudProductToLocal,
  markProductSyncConflict,
  normalizeNameKey
} from './productMapper';
import { PRODUCT_SYNC_STATUS } from './productConstants';
import { createProductCatalogSyncError } from './productCatalogSyncDiagnostics';
import { reconcileActiveTableReservations } from '../sales/tableReservationReconciliation';
import { assertValidRecipeReferences, getRecipeIngredientId } from '../../utils/ingredientConfiguration';

const nowIso = () => new Date().toISOString();

const createLocalMutationSync = (sync = {}) => ({
  ...sync,
  syncStatus: sync.syncStatus || PRODUCT_SYNC_STATUS.LOCAL,
  lastSyncedAt: null,
  pendingOperationId: sync.pendingOperationId ?? null,
  localMutationId: sync.localMutationId || generateID('mutation'),
  conflictReason: null
});

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const ensureOpen = async () => {
  if (!db.isOpen()) await db.open();
};

const isActiveCatalogRecord = (record) => (
  reco¶»§q«^