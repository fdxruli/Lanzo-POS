const PERISHABLE_KEYWORDS = [
  'verduleria',
  'fruteria',
  'frutas',
  'verduras',
  'carniceria',
  'polleria',
  'pescaderia',
  'panaderia',
  'lacteo',
  'lacteos',
  'farmacia',
  'alimentos preparados',
  'food_service',
  'food service',
  'restaurante',
  'dark kitchen',
  'abarrotes perecederos'
];

export const normalizeExpirationPolicyText = (value = '') => String(value || '')
  .trim()
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ');

const getNestedMetadataValue = (product, keys = []) => {
  const metadata = product?.metadata || {};
  for (const key of keys) {
    if (metadata?.[key] !== undefined && metadata?.[key] !== null) return metadata[key];
  }
  return null;
};

const isTruthy = (value) => ['true', '1', 'yes', 'si', 's'].includes(normalizeExpirationPolicyText(value));

export const getProductExpirationMode = (product) => (
  product?.expirationMode || product?.expiration_mode || 'NONE'
);

export const productRequiresBatchManagement = (product) => (
  product?.batchManagement?.enabled === true
  || product?.batch_management?.enabled === true
  || String(product?.batch_management?.enabled || '').toLowerCase() === 'true'
);

export const getProductContextText = (product, context = {}) => normalizeExpirationPolicyText([
  product?.rubroContext,
  product?.rubro,
  product?.category,
  product?.categoryName,
  product?.category_name,
  product?.categoryId,
  product?.category_id,
  context?.businessType,
  context?.categoryName,
  getNestedMetadataValue(product, ['rubro', 'rubroContext', 'businessType', 'categoryName', 'category'])
].filter(Boolean).join(' '));

export const isPerishableShelfLifeProduct = (product, context = {}) => {
  if (getProductExpirationMode(product) !== 'SHELF_LIFE') return false;

  const metadata = product?.metadata || {};
  const batchManagement = product?.batchManagement || product?.batch_management || {};

  if (
    product?.isPerishable === true
    || product?.is_perishable === true
    || isTruthy(metadata.perishableBlocking)
    || isTruthy(metadata.perishable_blocking)
    || isTruthy(metadata.isPerishable)
    || isTruthy(metadata.is_perishable)
    || isTruthy(batchManagement.perishableBlocking)
    || isTruthy(batchManagement.perishable_blocking)
  ) {
    return true;
  }

  const contextText = getProductContextText(product, context);
  return PERISHABLE_KEYWORDS.some((keyword) => contextText.includes(keyword));
};

const addShelfLifeToDate = (baseDate, value, unit = 'days') => {
  const amount = Number(value) || 0;
  if (amount <= 0) return null;

  const date = baseDate ? new Date(baseDate) : new Date();
  if (Number.isNaN(date.getTime())) return null;

  const normalizedUnit = normalizeExpirationPolicyText(unit);
  if (['hour', 'hours', 'hora', 'horas'].includes(normalizedUnit)) {
    date.setHours(date.getHours() + amount);
  } else if (['month', 'months', 'mes', 'meses'].includes(normalizedUnit)) {
    date.setMonth(date.getMonth() + amount);
  } else {
    date.setDate(date.getDate() + amount);
  }

  return date.toISOString();
};

export const getShelfLifeTargetDate = (product, batch = null) => {
  const directDate = batch?.alertTargetDate
    || batch?.alert_target_date
    || batch?.expiryDate
    || batch?.expiry_date
    || product?.alertTargetDate
    || product?.alert_target_date
    || product?.expiryDate
    || product?.expiry_date
    || getNestedMetadataValue(product, [
      'shelfLifeTargetDate',
      'shelf_life_target_date',
      'alertTargetDate',
      'alert_target_date',
      'expiryDate',
      'expiry_date'
    ]);

  if (directDate) return directDate;

  return addShelfLifeToDate(
    product?.createdAt || product?.created_at,
    product?.shelfLifeValue ?? product?.shelf_life_value,
    product?.shelfLifeUnit ?? product?.shelf_life_unit
  );
};

export const isShelfLifeExpiredForSale = (product, now = new Date(), batch = null, context = {}) => {
  if (!isPerishableShelfLifeProduct(product, context)) return false;

  const targetDate = getShelfLifeTargetDate(product, batch);
  if (!targetDate) return false;

  const target = new Date(targetDate);
  const today = new Date(now);
  if (Number.isNaN(target.getTime()) || Number.isNaN(today.getTime())) return false;

  const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return targetDay < todayDay;
};

export const getOperationalExpirationStatus = (item = {}) => {
  const category = item.operationalCategory || item.operational_category;
  const alertType = item.alertType || item.alert_type;

  if (category === 'vida_util_vencida' || alertType === 'VIDA_UTIL_VENCIDA') return 'shelf_life_expired';
  if (category === 'sin_lote_vigente' || alertType === 'SIN_LOTE_VIGENTE') return 'no_current_batch';
  if (category === 'requiere_regularizacion' || alertType === 'REQUIERE_REGULARIZACION_LOTE') return 'regularization_required';
  if (category === 'vencido' || item.expiryStatus === 'expired' || item.expiry_status === 'expired') return 'expired';
  return 'watch';
};
