import { generateID } from '../../../../services/utils';

export const isApparelContext = (activeRubroContext) => activeRubroContext === 'apparel';

export const hasActiveVariantRows = (quickVariants = []) => (
  quickVariants.some((variant) => (
    (variant.talla && variant.talla.trim() !== '')
    || (variant.color && variant.color.trim() !== '')
  ))
);

export const getTotalVariantStock = (quickVariants = []) => (
  quickVariants.reduce((sum, variant) => sum + (Number.parseFloat(variant.stock) || 0), 0)
);

export const normalizeWholesaleTiers = (wholesaleTiers = []) => (
  wholesaleTiers.map((tier) => ({
    ...tier,
    min: Number.parseFloat(tier.min),
    price: Number.parseFloat(tier.price)
  }))
);

export const buildBatchManagementConfig = ({
  isApparel,
  hasActiveVariants,
  trackStock
}) => {
  if (isApparel && hasActiveVariants) {
    return { enabled: true, selectionStrategy: 'fifo' };
  }

  if (trackStock) {
    return { enabled: true, selectionStrategy: 'fifo' };
  }

  return { enabled: false };
};

export const mapBatchesToVariantRows = (batches = [], fallbackCost = 0, fallbackPrice = 0) => (
  batches.map((batch) => ({
    id: batch.id,
    talla: batch.attributes?.talla || '',
    color: batch.attributes?.color || '',
    sku: batch.sku || '',
    stock: batch.stock || 0,
    cost: batch.cost || fallbackCost,
    price: batch.price || fallbackPrice
  }))
);

const buildAutoVariantSku = (variant = {}) => {
  const colorCode = variant.color ? variant.color.substring(0, 3).toUpperCase() : 'GEN';
  const sizeCode = variant.talla ? variant.talla.toUpperCase() : 'U';
  const randomCode = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `${colorCode}-${sizeCode}-${randomCode}`.toUpperCase().replace(/\s+/g, '');
};

export const buildVariantBatchPayload = ({
  variant,
  productId,
  commonData
}) => {
  const isNewVariant = typeof variant.id === 'number';
  const finalId = isNewVariant ? generateID('batch') : variant.id;
  const finalSku = variant.sku || buildAutoVariantSku(variant);

  return {
    id: finalId,
    productId,
    stock: Number.parseFloat(variant.stock) || 0,
    cost: Number.parseFloat(variant.cost) || commonData.cost,
    price: Number.parseFloat(variant.price) || commonData.price,
    sku: finalSku,
    attributes: {
      talla: String(variant.talla || '').toUpperCase(),
      color: variant.color
    },
    isActive: true,
    createdAt: isNewVariant ? new Date().toISOString() : undefined,
    trackStock: true
  };
};

