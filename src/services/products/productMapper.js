import { PRODUCT_CLOUD_PHASE, PRODUCT_SYNC_STATUS } from './productConstants';
import { normalizeModifierGroups } from '../../utils/restaurantModifiers';

const nowIso = () => new Date().toISOString();
const text = (value) => String(value ?? '').trim();
const optionalText = (value) => text(value) || null;

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const pick = (source, snakeKey, camelKey, fallback = null) => {
  if (!source) return fallback;
  if (source[camelKey] !== undefined) return source[camelKey];
  if (source[snakeKey] !== undefined) return source[snakeKey];
  return fallback;
};

const normalizeProductModifiersForStorage = (modifiers) => {
  const normalized = normalizeModifierGroups(modifiers);
  return normalized.length > 0 ? normalized : null;
};

export const normalizeNameKey = (value) => text(value).toLowerCase().replace(/\s+/g, ' ');
export const normalizeBarcodeKey = (value) => text(value).replace(/\s+/g, '');
export const normalizeSkuKey = (value) => text(value).toLowerCase().replace(/\s+/g, '');

export const categoryToCloudPayload = (category = {}) => ({
  id: category.id,
  name: text(category.name),
  name_key: normalizeNameKey(category.name),
  color: category.color || '#cccccc',
  sort_order: toNumber(category.sortOrder ?? category.sort_order, 0),
  is_active: category.isActive !== false,
  created_at: category.createdAt || category.created_at || nowIso(),
  updated_at: category.updatedAt || category.updated_at || nowIso(),
  metadata: { ...(category.metadata || {}), phase: PRODUCT_CLOUD_PHASE }
});

export const cloudCategoryToLocal = (category = {}, existing = null, overrides = {}) => {
  const deletedAt = pick(category, 'deleted_at', 'deletedAt', existing?.deletedAt || null);

  return {
    ...existing,
    id: category.id,
    name: category.name || existing?.name || '',
    color: category.color || existing?.color || '#cccccc',
    sortOrder: toNumber(category.sort_order ?? category.sortOrder, existing?.sortOrder || 0),
    isActive: deletedAt ? false : (category.is_active ?? category.isActive ?? existing?.isActive ?? true),
    createdAt: pick(category, 'created_at', 'createdAt', existing?.createdAt || nowIso()),
    updatedAt: pick(category, 'updated_at', 'cloudUpdatedAt', nowIso()),
    deletedAt,
    serverVersion: toNumber(category.server_version ?? category.serverVersion, existing?.serverVersion || null),
    cloudUpdatedAt: pick(category, 'updated_at', 'cloudUpdatedAt', existing?.cloudUpdatedAt || null),
    syncStatus: overrides.syncStatus || PRODUCT_SYNC_STATUS.SYNCED,
    lastSyncedAt: overrides.lastSyncedAt || nowIso(),
    pendingOperationId: overrides.pendingOperationId ?? null,
    conflictReason: overrides.conflictReason ?? null,
    metadata: category.metadata || existing?.metadata || {}
  };
};

export const productToCloudPayload = (product = {}) => ({
  id: product.id,
  category_id: optionalText(product.categoryId ?? product.category_id),
  name: text(product.name),
  name_key: normalizeNameKey(product.name),
  description: optionalText(product.description),
  barcode: optionalText(product.barcode),
  barcode_key: normalizeBarcodeKey(product.barcode_normalized || product.barcode),
  sku: optionalText(product.sku),
  sku_key: normalizeSkuKey(product.sku_normalized || product.sku),
  image_ref: optionalText(product.imageRef || product.image),
  image_url: optionalText(product.imageUrl),
  location: optionalText(product.location),
  price: toNumber(product.price),
  cost: toNumber(product.cost),
  stock: toNumber(product.stock),
  committed_stock: toNumber(product.committedStock ?? product.committed_stock),
  min_stock: product.minStock ?? product.min_stock ?? null,
  max_stock: product.maxStock ?? product.max_stock ?? null,
  track_stock: product.trackStock !== false,
  is_active: product.isActive !== false,
  product_type: product.productType || product.product_type || 'sellable',
  sale_type: product.saleType || product.sale_type || 'unit',
  bulk_data: product.bulkData ?? product.bulk_data ?? null,
  conversion_factor: product.conversionFactor ?? product.conversion_factor ?? null,
  batch_management: product.batchManagement ?? product.batch_management ?? null,
  recipe: product.recipe ?? null,
  modifiers: normalizeProductModifiersForStorage(product.modifiers),
  wholesale_tiers: product.wholesaleTiers ?? product.wholesale_tiers ?? null,
  prescription_type: optionalText(product.prescriptionType ?? product.prescription_type),
  active_substance: optionalText(product.activeSubstance ?? product.active_substance ?? product.sustancia),
  laboratory: optionalText(product.laboratory ?? product.laboratorio),
  requires_prescription: product.requiresPrescription ?? product.requires_prescription ?? null,
  presentation: optionalText(product.presentation),
  expiration_mode: product.expirationMode || product.expiration_mode || 'NONE',
  shelf_life_value: product.shelfLifeValue ?? product.shelf_life_value ?? null,
  shelf_life_unit: product.shelfLifeUnit ?? product.shelf_life_unit ?? null,
  low_stock_alert_status: product.lowStockAlertStatus ?? product.low_stock_alert_status ?? null,
  active_stock_status: toNumber(product.activeStockStatus ?? product.active_stock_status),
  created_at: product.createdAt || product.created_at || nowIso(),
  updated_at: product.updatedAt || product.updated_at || nowIso(),
  metadata: {
    ...(product.metadata || {}),
    phase: PRODUCT_CLOUD_PHASE,
    image_strategy: 'local_reference_only'
  }
});

export const cloudProductToLocal = (product = {}, existing = null, overrides = {}) => {
  const deletedAt = pick(product, 'deleted_at', 'deletedAt', existing?.deletedAt || null);
  const name = product.name || existing?.name || '';

  return {
    ...existing,
    id: product.id,
    name,
    name_lower: text(name).toLowerCase(),
    category: product.category || existing?.category || '',
    categoryId: product.category_id || product.categoryId || '',
    description: product.description || '',
    barcode: product.barcode || '',
    barcode_normalized: product.barcode_key || product.barcode_normalized || '',
    sku: product.sku || '',
    sku_normalized: product.sku_key || product.sku_normalized || '',
    image: product.image_ref || product.image || product.imageRef || null,
    imageRef: product.image_ref || product.imageRef || null,
    imageUrl: product.image_url || product.imageUrl || null,
    location: product.location || '',
    price: toNumber(product.price),
    cost: toNumber(product.cost),
    stock: toNumber(product.stock),
    committedStock: toNumber(product.committed_stock ?? product.committedStock),
    minStock: product.min_stock ?? product.minStock ?? null,
    maxStock: product.max_stock ?? product.maxStock ?? null,
    trackStock: product.track_stock ?? product.trackStock ?? true,
    isActive: deletedAt ? false : (product.is_active ?? product.isActive ?? true),
    productType: product.product_type || product.productType || 'sellable',
    saleType: product.sale_type || product.saleType || 'unit',
    bulkData: product.bulk_data ?? product.bulkData ?? null,
    conversionFactor: product.conversion_factor ?? product.conversionFactor ?? null,
    batchManagement: product.batch_management ?? product.batchManagement ?? null,
    recipe: product.recipe ?? null,
    modifiers: normalizeProductModifiersForStorage(product.modifiers ?? existing?.modifiers ?? []) || [],
    wholesaleTiers: product.wholesale_tiers ?? product.wholesaleTiers ?? null,
    prescriptionType: product.prescription_type ?? product.prescriptionType ?? undefined,
    activeSubstance: product.active_substance ?? product.activeSubstance ?? undefined,
    laboratory: product.laboratory ?? undefined,
    requiresPrescription: product.requires_prescription ?? product.requiresPrescription ?? undefined,
    presentation: product.presentation ?? null,
    expirationMode: product.expiration_mode || product.expirationMode || 'NONE',
    shelfLifeValue: product.shelf_life_value ?? product.shelfLifeValue ?? null,
    shelfLifeUnit: product.shelf_life_unit || product.shelfLifeUnit || null,
    lowStockAlertStatus: product.low_stock_alert_status ?? product.lowStockAlertStatus ?? null,
    activeStockStatus: toNumber(product.active_stock_status ?? product.activeStockStatus),
    createdAt: pick(product, 'created_at', 'createdAt', existing?.createdAt || nowIso()),
    updatedAt: pick(product, 'updated_at', 'createdAt', nowIso()),
    deletedAt,
    serverVersion: toNumber(product.server_version ?? product.serverVersion, existing?.serverVersion || null),
    cloudUpdatedAt: pick(product, 'updated_at', 'cloudUpdatedAt', existing?.cloudUpdatedAt || null),
    syncStatus: overrides.syncStatus || PRODUCT_SYNC_STATUS.SYNCED,
    lastSyncedAt: overrides.lastSyncedAt || nowIso(),
    pendingOperationId: overrides.pendingOperationId ?? null,
    conflictReason: overrides.conflictReason ?? null,
    metadata: product.metadata || existing?.metadata || {}
  };
};

export const batchToCloudPayload = (batch = {}) => ({
  id: batch.id,
  product_id: batch.productId || batch.product_id,
  sku: optionalText(batch.sku),
  sku_key: normalizeSkuKey(batch.skuKey || batch.sku_key || batch.sku),
  stock: toNumber(batch.stock),
  committed_stock: toNumber(batch.committedStock ?? batch.committed_stock),
  cost: toNumber(batch.cost),
  price: toNumber(batch.price),
  track_stock: batch.trackStock !== false,
  is_active: batch.isActive !== false,
  status: batch.status || (batch.isActive === false ? 'inactive' : 'active'),
  active_stock_status: toNumber(batch.activeStockStatus ?? batch.active_stock_status),
  expiry_date: batch.expiryDate ?? batch.expiry_date ?? null,
  alert_target_date: batch.alertTargetDate ?? batch.alert_target_date ?? batch.expiryDate ?? null,
  alert_type: batch.alertType ?? batch.alert_type ?? null,
  manufacturer_batch_id: optionalText(batch.manufacturerBatchId ?? batch.manufacturer_batch_id),
  supplier: optionalText(batch.supplier),
  attributes: batch.attributes ?? null,
  location: optionalText(batch.location),
  notes: optionalText(batch.notes),
  update_global_price: batch.updateGlobalPrice === true || batch.update_global_price === true,
  created_at: batch.createdAt || batch.created_at || nowIso(),
  updated_at: batch.updatedAt || batch.updated_at || nowIso(),
  metadata: { ...(batch.metadata || {}), phase: PRODUCT_CLOUD_PHASE }
});

export const cloudBatchToLocal = (batch = {}, existing = null, overrides = {}) => {
  const deletedAt = pick(batch, 'deleted_at', 'deletedAt', existing?.deletedAt || null);

  return {
    ...existing,
    id: batch.id,
    productId: batch.product_id || batch.productId,
    sku: batch.sku || '',
    skuKey: batch.sku_key || batch.skuKey || '',
    stock: toNumber(batch.stock),
    committedStock: toNumber(batch.committed_stock ?? batch.committedStock),
    cost: toNumber(batch.cost),
    price: toNumber(batch.price),
    trackStock: batch.track_stock ?? batch.trackStock ?? true,
    isActive: deletedAt ? false : (batch.is_active ?? batch.isActive ?? true),
    status: batch.status || 'active',
    activeStockStatus: toNumber(batch.active_stock_status ?? batch.activeStockStatus),
    expiryDate: batch.expiry_date || batch.expiryDate || null,
    alertTargetDate: batch.alert_target_date || batch.alertTargetDate || null,
    alertType: batch.alert_type || batch.alertType || null,
    manufacturerBatchId: batch.manufacturer_batch_id || batch.manufacturerBatchId || null,
    supplier: batch.supplier || null,
    attributes: batch.attributes || null,
    location: batch.location || null,
    notes: batch.notes || null,
    updateGlobalPrice: batch.update_global_price === true || batch.updateGlobalPrice === true,
    createdAt: pick(batch, 'created_at', 'createdAt', existing?.createdAt || nowIso()),
    updatedAt: pick(batch, 'updated_at', 'cloudUpdatedAt', nowIso()),
    deletedAt,
    serverVersion: toNumber(batch.server_version ?? batch.serverVersion, existing?.serverVersion || null),
    cloudUpdatedAt: pick(batch, 'updated_at', 'cloudUpdatedAt', existing?.cloudUpdatedAt || null),
    syncStatus: overrides.syncStatus || PRODUCT_SYNC_STATUS.SYNCED,
    lastSyncedAt: overrides.lastSyncedAt || nowIso(),
    pendingOperationId: overrides.pendingOperationId ?? null,
    conflictReason: overrides.conflictReason ?? null,
    metadata: batch.metadata || existing?.metadata || {}
  };
};

export const markProductSyncConflict = (record = {}, reason = 'VERSION_CONFLICT') => ({
  ...record,
  syncStatus: PRODUCT_SYNC_STATUS.CONFLICT,
  conflictReason: reason,
  pendingOperationId: null
});
