import { db, STORES } from '../db/dexie';
import { generateID } from '../utils';
import { generateIdempotencyKey } from '../sync/idempotency';
import { syncOutboxService } from '../sync/syncOutboxService';
import {
  getLicenseKeyFromDetails,
  isCloudProductsSyncEnabled,
  POS_SYNC_STORES,
  SYNC_ENTITY_TYPES,
  SYNC_OPERATIONS
} from '../sync/syncConstants';
import { PRODUCT_SYNC_STATUS } from '../products/productConstants';
import { useAppStore } from '../../store/useAppStore';
import { captureProductInventoryMutation, actorOriginFromHandle, assertProductInventoryMutationCurrent } from '../auth/productInventoryAuthority';
import { productCloudRepository } from '../products/productCloudRepository';
import { normalizeActiveIngredientNameKey } from './pharmacyComposition';

const nowIso = () => new Date().toISOString();
const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

const isRetryableCloudError = (error) => {
  if (!isOnline() || error?.name === 'TypeError') return true;
  const message = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  return ['timeout', 'failed to fetch', 'networkerror', 'network request failed', 'temporarily unavailable', '502', '503', '504']
    .some((part) => message.includes(part));
};

const getMode = () => {
  const state = useAppStore.getState();
  const licenseDetails = state?.licenseDetails || null;
  const licenseKey = getLicenseKeyFromDetails(licenseDetails);
  return {
    licenseKey,
    businessKey: licenseKey || db.name,
    cloudEnabled: Boolean(licenseKey && isCloudProductsSyncEnabled(licenseDetails))
  };
};

const ensureOpen = async () => {
  if (!db.isOpen()) await db.open();
};

const stableIngredientId = async (businessKey, nameKey) => {
  const value = `${businessKey}\n${nameKey}`;
  if (typeof crypto !== 'undefined' && crypto.subtle?.digest && typeof TextEncoder !== 'undefined') {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    const hex = Array.from(new Uint8Array(bytes), (item) => item.toString(16).padStart(2, '0')).join('');
    return `ai-${hex}`;
  }
  // The server's unique (license_id, name_key) constraint remains authoritative.
  return generateID('ai');
};

const compareIdentityCandidates = (left, right, nameKey) => {
  const leftKeyMatch = left.nameKey === nameKey ? 1 : 0;
  const rightKeyMatch = right.nameKey === nameKey ? 1 : 0;
  if (leftKeyMatch !== rightKeyMatch) return rightKeyMatch - leftKeyMatch;

  const leftActive = left.isActive !== false && !left.deletedAt ? 1 : 0;
  const rightActive = right.isActive !== false && !right.deletedAt ? 1 : 0;
  if (leftActive !== rightActive) return rightActive - leftActive;

  const leftSynced = left.syncStatus === PRODUCT_SYNC_STATUS.SYNCED && left.serverVersion ? 1 : 0;
  const rightSynced = right.syncStatus === PRODUCT_SYNC_STATUS.SYNCED && right.serverVersion ? 1 : 0;
  if (leftSynced !== rightSynced) return rightSynced - leftSynced;

  return String(left.createdAt || '').localeCompare(String(right.createdAt || ''))
    || String(left.id).localeCompare(String(right.id));
};

const bestIdentityCandidate = (rows, nameKey) => {
  const normalizedNameKey = normalizeActiveIngredientNameKey(nameKey);
  if (!normalizedNameKey) return null;
  return rows
    .filter((row) => normalizeActiveIngredientNameKey(row.name) === normalizedNameKey)
    .sort((left, right) => compareIdentityCandidates(left, right, nameKey))[0] || null;
};

export const cloudActiveIngredientToLocal = (row, existing = null, overrides = {}) => {
  const name = String(row?.name ?? existing?.name ?? '').trim();
  return {
    ...existing,
    id: row?.id || existing?.id,
    businessKey: overrides.businessKey || existing?.businessKey || getMode().businessKey,
    name,
    nameKey: row?.name_key || row?.nameKey || normalizeActiveIngredientNameKey(name),
    isActive: row?.deleted_at ? false : (row?.is_active ?? row?.isActive ?? true),
    createdAt: row?.created_at || row?.createdAt || existing?.createdAt || nowIso(),
    updatedAt: row?.updated_at || row?.updatedAt || nowIso(),
    deletedAt: row?.deleted_at || row?.deletedAt || null,
    serverVersion: Number(row?.server_version ?? row?.serverVersion ?? existing?.serverVersion) || null,
    syncStatus: overrides.syncStatus || PRODUCT_SYNC_STATUS.SYNCED,
    lastSyncedAt: nowIso(),
    pendingOperationId: null,
    localMutationId: null,
    conflictReason: null
  };
};

const rewriteCompositionIds = (product, fromId, toId, canonicalName) => {
  if (!product || fromId === toId) return product;
  const metadata = product.metadata || {};
  const pharmacy = metadata.pharmacy || product.pharmacy || {};
  const composition = pharmacy.composition;
  if (!Array.isArray(composition?.activeIngredients)) return product;
  const activeIngredients = composition.activeIngredients.map((item) => (
    item?.activeIngredientId === fromId
      ? { ...item, activeIngredientId: toId, name: canonicalName || item.name }
      : item
  ));
  const nextPharmacy = { ...pharmacy, composition: { ...composition, activeIngredients } };
  return product.metadata
    ? { ...product, metadata: { ...metadata, pharmacy: nextPharmacy } }
    : { ...product, pharmacy: nextPharmacy };
};

const queueActiveIngredient = async ({ ingredient, licenseKey, actorHandle, idempotencyKey = null }) => {
  const mode = getMode();
  const key = ingredient.pendingOperationId || idempotencyKey || generateIdempotencyKey({
    entityType: SYNC_ENTITY_TYPES.ACTIVE_INGREDIENT,
    operation: SYNC_OPERATIONS.UPSERT,
    entityId: ingredient.id,
    prefix: 'pharmacy'
  });
  const pending = {
    ...ingredient,
    businessKey: mode.businessKey,
    syncStatus: PRODUCT_SYNC_STATUS.PENDING,
    pendingOperationId: key,
    localMutationId: key,
    lastSyncedAt: null
  };
  await ensureOpen();
  await db.table(STORES.ACTIVE_INGREDIENTS).put(pending);
  actorHandle.assertCurrent();
  await syncOutboxService.enqueueOperation({
    licenseKey,
    entityType: SYNC_ENTITY_TYPES.ACTIVE_INGREDIENT,
    operation: SYNC_OPERATIONS.UPSERT,
    entityId: ingredient.id,
    payload: { activeIngredient: ingredient, expectedVersion: ingredient.serverVersion || null },
    idempotencyKey: key,
    actorSensitive: true,
    originActor: actorOriginFromHandle(actorHandle),
    metadata: { source: 'activeIngredientRepository', queuedAt: nowIso() }
  });
  return pending;
};

export const activeIngredientRepository = {
  async list({ includeArchived = false } = {}) {
    await ensureOpen();
    const mode = getMode();
    const rows = await db.table(STORES.ACTIVE_INGREDIENTS).toArray();
    return rows
      .filter((row) => (row.businessKey === mode.businessKey
        || (mode.cloudEnabled && row.businessKey === db.name && row.syncStatus !== PRODUCT_SYNC_STATUS.SYNCED))
        && (includeArchived || (row.isActive !== false && !row.deletedAt)))
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
  },

  async getById(id) {
    if (!id) return null;
    await ensureOpen();
    const row = await db.table(STORES.ACTIVE_INGREDIENTS).get(id);
    const mode = getMode();
    return row?.businessKey === mode.businessKey
      || (mode.cloudEnabled && row?.businessKey === db.name && row?.syncStatus !== PRODUCT_SYNC_STATUS.SYNCED)
      ? row : null;
  },

  async getByNameKey(nameKey) {
    if (!nameKey) return null;
    await ensureOpen();
    const mode = getMode();
    const rows = await db.table(STORES.ACTIVE_INGREDIENTS).toArray();
    const scoped = bestIdentityCandidate(
      rows.filter((row) => row.businessKey === mode.businessKey),
      nameKey
    );
    if (scoped || !mode.cloudEnabled) return scoped;
    return bestIdentityCandidate(
      rows.filter((row) => row.businessKey === db.name
        && row.syncStatus !== PRODUCT_SYNC_STATUS.SYNCED),
      nameKey
    );
  },

  async hasPending(ids = []) {
    await ensureOpen();
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    const rows = await Promise.all(uniqueIds.map((id) => this.getById(id)));
    return rows.length !== uniqueIds.length || rows.some((row) => (
      !row || row.syncStatus !== PRODUCT_SYNC_STATUS.SYNCED || !row.serverVersion
    ));
  },

  async ensureQueued(ids = [], { licenseKey, actorHandle } = {}) {
    await ensureOpen();
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    const rows = await Promise.all(uniqueIds.map((id) => this.getById(id)));
    for (const row of rows) {
      if (!row) throw new Error('PHARMACY_ACTIVE_INGREDIENT_REFERENCE_MISSING');
      if (row.syncStatus === PRODUCT_SYNC_STATUS.SYNCED && row.serverVersion) continue;
      await queueActiveIngredient({ ingredient: row, licenseKey, actorHandle });
    }
    return rows;
  },

  async applyCloudRecord(cloudRow, { localId = null, actorHandle = null } = {}) {
    if (!cloudRow?.id) throw new Error('PHARMACY_ACTIVE_INGREDIENT_ID_REQUIRED');
    await ensureOpen();
    actorHandle?.assertCurrent?.();
    const canonicalId = cloudRow.id;
    const originalId = localId || cloudRow.client_id || canonicalId;
    return db.transaction('rw', [STORES.ACTIVE_INGREDIENTS, STORES.MENU, POS_SYNC_STORES.OUTBOX], async () => {
      actorHandle?.assertCurrent?.();
      const table = db.table(STORES.ACTIVE_INGREDIENTS);
      const existing = await table.get(originalId) || await table.get(canonicalId);
      const mode = getMode();
      const existingIsCurrent = existing?.businessKey === mode.businessKey
        || (mode.cloudEnabled && existing?.businessKey === db.name
          && existing?.syncStatus !== PRODUCT_SYNC_STATUS.SYNCED);
      if (existing && !existingIsCurrent) throw new Error('PHARMACY_ACTIVE_INGREDIENT_TENANT_MISMATCH');
      const aliases = [...new Set([...(existing?.clientIds || []), originalId].filter((id) => id && id !== canonicalId))];
      const canonical = {
        ...cloudActiveIngredientToLocal(cloudRow, existing, { businessKey: getMode().businessKey }),
        id: canonicalId,
        clientIds: aliases
      };
      if (originalId !== canonicalId) await table.delete(originalId);
      await table.put(canonical);

      if (originalId !== canonicalId) {
        const products = await db.table(STORES.MENU).toArray();
        for (const product of products) {
          const rewritten = rewriteCompositionIds(product, originalId, canonicalId, canonical.name);
          if (rewritten !== product) await db.table(STORES.MENU).put(rewritten);
        }
        const pendingProducts = await db.table(POS_SYNC_STORES.OUTBOX)
          .where('entityType').equals(SYNC_ENTITY_TYPES.PRODUCT)
          .filter((operation) => operation.status !== 'synced' && operation.status !== 'completed')
          .toArray();
        for (const operation of pendingProducts) {
          const rewritten = rewriteCompositionIds(operation.payload?.product, originalId, canonicalId, canonical.name);
          if (rewritten !== operation.payload?.product) {
            await db.table(POS_SYNC_STORES.OUTBOX).update(operation.id, {
              payload: { ...operation.payload, product: rewritten },
              updatedAt: nowIso()
            });
          }
        }
      }
      actorHandle?.assertCurrent?.();
      return canonical;
    });
  },

  async create(nameValue) {
    const name = String(nameValue ?? '').trim();
    const nameKey = normalizeActiveIngredientNameKey(name);
    if (!nameKey) throw new Error('PHARMACY_ACTIVE_INGREDIENT_NAME_REQUIRED');
    if (name.length > 160) throw new Error('PHARMACY_ACTIVE_INGREDIENT_NAME_TOO_LONG');

    const mode = getMode();
    const actorHandle = captureProductInventoryMutation({ products: true });
    assertProductInventoryMutationCurrent(actorHandle, { products: true });
    const existing = await this.getByNameKey(nameKey);
    if (existing) {
      if (existing.isActive !== false && !existing.deletedAt) {
        if (mode.cloudEnabled && (existing.syncStatus !== PRODUCT_SYNC_STATUS.SYNCED || !existing.serverVersion)) {
          return queueActiveIngredient({ ingredient: existing, licenseKey: mode.licenseKey, actorHandle });
        }
        return existing;
      }
      const reactivated = { ...existing, isActive: true, deletedAt: null, name, updatedAt: nowIso() };
      if (!mode.cloudEnabled) {
        await db.table(STORES.ACTIVE_INGREDIENTS).put({ ...reactivated, syncStatus: PRODUCT_SYNC_STATUS.LOCAL });
        return reactivated;
      }
    }

    const id = existing?.id || await stableIngredientId(mode.licenseKey, nameKey);
    const ingredient = {
      ...(existing || {}),
      id,
      businessKey: mode.businessKey,
      name,
      nameKey,
      isActive: true,
      createdAt: existing?.createdAt || nowIso(),
      updatedAt: nowIso(),
      deletedAt: null
    };

    if (!mode.cloudEnabled) {
      await ensureOpen();
      await db.transaction('rw', STORES.ACTIVE_INGREDIENTS, async () => {
        const duplicate = await db.table(STORES.ACTIVE_INGREDIENTS)
          .where('[businessKey+nameKey]').equals([mode.businessKey, nameKey]).first();
        if (duplicate) return;
        await db.table(STORES.ACTIVE_INGREDIENTS).put({ ...ingredient, syncStatus: PRODUCT_SYNC_STATUS.LOCAL });
      });
      return (await this.getByNameKey(nameKey)) || ingredient;
    }

    const idempotencyKey = generateIdempotencyKey({
      entityType: SYNC_ENTITY_TYPES.ACTIVE_INGREDIENT,
      operation: SYNC_OPERATIONS.UPSERT,
      entityId: ingredient.id,
      prefix: 'pharmacy'
    });
    if (isOnline()) {
      try {
        const response = await productCloudRepository.upsertActiveIngredient({
          licenseKey: mode.licenseKey,
          activeIngredient: ingredient,
          expectedVersion: existing?.serverVersion || null,
          idempotencyKey,
          actorHandle
        });
        if (response?.success === true && response.active_ingredient) {
          actorHandle.assertCurrent();
          const canonical = await this.applyCloudRecord(response.active_ingredient, { localId: ingredient.id, actorHandle });
          actorHandle.assertCurrent();
          return canonical;
        }
        if (response?.success === false && response.code !== 'CLOUD_PHARMACY_ACTIVE_INGREDIENT_CAPABILITY_REQUIRED') {
          throw Object.assign(new Error(response.message || response.code || 'PHARMACY_ACTIVE_INGREDIENT_SYNC_FAILED'), response);
        }
      } catch (error) {
        if (!isRetryableCloudError(error) && error?.code !== 'CLOUD_PHARMACY_ACTIVE_INGREDIENT_CAPABILITY_REQUIRED') throw error;
      }
    }

    return queueActiveIngredient({ ingredient, licenseKey: mode.licenseKey, actorHandle, idempotencyKey });
  }
};
