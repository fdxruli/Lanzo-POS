import {
  convertInventoryQuantity,
  getInventoryUnitFamily,
  normalizeInventoryUnit
} from '../../utils/ecommerceProductConfiguration';
import {
  getAvailableBatchStock,
  getBatchExpiryValue,
  isBatchActiveForFefo,
  sortBatchesByFefo
} from '../products/fefoUtils';
import { getBatchExpiryStatus } from '../../utils/dateUtils';

const BLOCKED_BATCH_STATUSES = new Set([
  'inactive', 'blocked', 'quarantined', 'deleted', 'removed', 'archived'
]);
const EXPIRY_REQUIRED_MODES = new Set(['STRICT', 'SHELF_LIFE', 'BATCH']);
const EPSILON = 1e-9;

const asText = (value) => String(value ?? '').trim();
const asStatus = (value) => asText(value).toLowerCase();
const asArray = (value) => (Array.isArray(value) ? value : []);
const getMapValue = (collection, id) => {
  if (collection instanceof Map) return collection.get(id);
  if (collection && typeof collection === 'object') return collection[id];
  return undefined;
};

const isInactive = (product = {}) => (
  product.isActive === false
  || product.is_active === false
  || Boolean(product.deletedAt || product.deleted_at || product.deletedTimestamp)
  || ['inactive', 'deleted', 'archived'].includes(asStatus(product.status))
);

const isBatchManaged = (product = {}) => (
  product.batchManagement?.enabled === true
  || product.batch_management?.enabled === true
  || asStatus(product.expirationMode || product.expiration_mode) === 'batch'
);

const getInventoryUnit = (product = {}) => normalizeInventoryUnit(
  product.inventoryUnit
  ?? product.inventory_unit
  ?? product.unit
  ?? product.bulkData?.purchase?.unit
  ?? product.bulk_data?.purchase?.unit
  ?? product.bulkData?.unit
  ?? product.bulk_data?.unit
  ?? product.measurementUnit
  ?? product.measurement_unit
  ?? product.saleUnit
  ?? product.sale_unit
  ?? 'pza'
);

const getRecipeUnit = (component = {}, ingredient = {}) => normalizeInventoryUnit(
  component.unit
  ?? component.ingredientUnit
  ?? component.ingredient_unit
  ?? getInventoryUnit(ingredient)
);

const getRawStockState = (record = {}) => {
  const stockValue = record.stock ?? record.quantity;
  const committedValue = record.committedStock ?? record.committed_stock ?? 0;
  const stock = Number(stockValue);
  const committed = Number(committedValue);
  if (
    stockValue === null
    || stockValue === undefined
    || stockValue === ''
    || !Number.isFinite(stock)
    || !Number.isFinite(committed)
    || stock < 0
    || committed < 0
  ) {
    return { verified: false, available: null };
  }
  return {
    verified: true,
    available: Math.max(0, stock - committed)
  };
};

const isBlockedBatch = (batch = {}) => (
  batch.isBlocked === true
  || batch.is_blocked === true
  || batch.blocked === true
  || BLOCKED_BATCH_STATUSES.has(asStatus(batch.status))
);

const getEligibleBatchStock = ({ batches, ingredient, now }) => {
  let hasInvalidStock = false;
  let total = 0;
  const eligible = [];
  const expiryMode = asText(
    ingredient.expirationMode ?? ingredient.expiration_mode ?? 'NONE'
  ).toUpperCase();

  sortBatchesByFefo(asArray(batches)).forEach((batch) => {
    if (!isBatchActiveForFefo(batch) || isBlockedBatch(batch)) return;
    const stockState = getRawStockState(batch);
    if (!stockState.verified) {
      hasInvalidStock = true;
      return;
    }
    if (stockState.available <= EPSILON) return;

    if (EXPIRY_REQUIRED_MODES.has(expiryMode)) {
      const status = getBatchExpiryStatus({
        expiryDate: getBatchExpiryValue(batch)
      }, now);
      if (status !== 'valid' && status !== 'expires_today') return;
    }

    const available = getAvailableBatchStock(batch);
    total += available;
    eligible.push({
      batchId: batch.id ?? batch.batchId ?? null,
      available,
      expiryDate: getBatchExpiryValue(batch) || null
    });
  });

  return {
    verified: !(total <= EPSILON && hasInvalidStock),
    available: total,
    batches: eligible
  };
};

const result = ({
  verified,
  status,
  availableStock,
  reasonCode,
  limiting = null,
  components = [],
  diagnostics = []
}) => ({
  verified,
  status,
  availableStock,
  limitingIngredientId: limiting?.ingredientId || null,
  limitingIngredientName: limiting?.ingredientName || null,
  reasonCode,
  components,
  diagnostics
});

export const evaluateEcommerceRecipeAvailability = ({
  product,
  recipe = product?.recipe,
  ingredientsById,
  batchesByProductId = new Map(),
  batches = null,
  now = new Date(),
  batchReadFailed = false
} = {}) => {
  const components = asArray(recipe);
  if (components.length === 0) {
    return result({
      verified: false,
      status: 'not_recipe',
      availableStock: null,
      reasonCode: 'RECIPE_EMPTY'
    });
  }

  const normalizedNow = now instanceof Date ? now : new Date(now);
  const evaluated = [];
  const diagnostics = [];
  let decisiveZero = null;
  let hasTrackedIngredient = false;
  let hasUnverified = false;

  for (let index = 0; index < components.length; index += 1) {
    const component = components[index] || {};
    const ingredientId = asText(
      component.ingredientId ?? component.ingredient_id ?? component.productId
    );
    const ingredientNameFallback = asText(component.name) || `Ingrediente ${index + 1}`;
    const quantity = Number(
      component.quantity ?? component.ingredientQuantity ?? component.ingredient_quantity
    );

    if (!ingredientId) {
      hasUnverified = true;
      diagnostics.push('RECIPE_INGREDIENT_MISSING');
      evaluated.push({
        ingredientId: null,
        ingredientName: ingredientNameFallback,
        verified: false,
        reasonCode: 'RECIPE_INGREDIENT_MISSING'
      });
      continue;
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      hasUnverified = true;
      diagnostics.push('RECIPE_QUANTITY_INVALID');
      evaluated.push({
        ingredientId,
        ingredientName: ingredientNameFallback,
        verified: false,
        reasonCode: 'RECIPE_QUANTITY_INVALID'
      });
      continue;
    }

    const ingredient = getMapValue(ingredientsById, ingredientId);
    if (!ingredient) {
      hasUnverified = true;
      diagnostics.push('RECIPE_INGREDIENT_MISSING');
      evaluated.push({
        ingredientId,
        ingredientName: ingredientNameFallback,
        verified: false,
        reasonCode: 'RECIPE_INGREDIENT_MISSING'
      });
      continue;
    }

    const ingredientName = asText(ingredient.name) || ingredientNameFallback;
    if (isInactive(ingredient)) {
      hasUnverified = true;
      diagnostics.push('RECIPE_INGREDIENT_INACTIVE');
      evaluated.push({
        ingredientId,
        ingredientName,
        verified: false,
        reasonCode: 'RECIPE_INGREDIENT_INACTIVE'
      });
      continue;
    }

    if (ingredient.trackStock === false || ingredient.track_stock === false) {
      evaluated.push({
        ingredientId,
        ingredientName,
        verified: true,
        tracked: false,
        capacity: null,
        reasonCode: 'RECIPE_INGREDIENT_UNTRACKED'
      });
      continue;
    }
    hasTrackedIngredient = true;

    const inventoryUnit = getInventoryUnit(ingredient);
    const recipeUnit = getRecipeUnit(component, ingredient);
    if (
      !inventoryUnit
      || !recipeUnit
      || getInventoryUnitFamily(inventoryUnit) !== getInventoryUnitFamily(recipeUnit)
    ) {
      hasUnverified = true;
      diagnostics.push('RECIPE_UNIT_INCOMPATIBLE');
      evaluated.push({
        ingredientId,
        ingredientName,
        verified: false,
        tracked: true,
        inventoryUnit,
        recipeUnit,
        reasonCode: 'RECIPE_UNIT_INCOMPATIBLE'
      });
      continue;
    }

    let stockState;
    let batchDetails = [];
    if (isBatchManaged(ingredient)) {
      if (batchReadFailed) {
        hasUnverified = true;
        diagnostics.push('RECIPE_BATCH_READ_FAILED');
        evaluated.push({
          ingredientId,
          ingredientName,
          verified: false,
          tracked: true,
          reasonCode: 'RECIPE_BATCH_READ_FAILED'
        });
        continue;
      }
      const ingredientBatches = batches
        ? asArray(batches).filter((batch) => (
          asText(batch.productId ?? batch.product_id) === ingredientId
        ))
        : asArray(getMapValue(batchesByProductId, ingredientId));
      stockState = getEligibleBatchStock({
        batches: ingredientBatches,
        ingredient,
        now: normalizedNow
      });
      batchDetails = stockState.batches || [];
    } else {
      stockState = getRawStockState(ingredient);
    }

    if (!stockState.verified) {
      hasUnverified = true;
      diagnostics.push('RECIPE_STOCK_INVALID');
      evaluated.push({
        ingredientId,
        ingredientName,
        verified: false,
        tracked: true,
        inventoryUnit,
        recipeUnit,
        reasonCode: 'RECIPE_STOCK_INVALID'
      });
      continue;
    }

    const availableInRecipeUnit = convertInventoryQuantity(
      stockState.available,
      inventoryUnit,
      recipeUnit
    );
    if (!Number.isFinite(availableInRecipeUnit)) {
      hasUnverified = true;
      diagnostics.push('RECIPE_UNIT_INCOMPATIBLE');
      evaluated.push({
        ingredientId,
        ingredientName,
        verified: false,
        tracked: true,
        inventoryUnit,
        recipeUnit,
        reasonCode: 'RECIPE_UNIT_INCOMPATIBLE'
      });
      continue;
    }

    const capacity = Math.max(0, Math.floor(
      (availableInRecipeUnit + EPSILON) / quantity
    ));
    const componentResult = {
      ingredientId,
      ingredientName,
      verified: true,
      tracked: true,
      inventoryUnit,
      recipeUnit,
      requiredPerUnit: quantity,
      availableInventory: stockState.available,
      availableInRecipeUnit,
      capacity,
      batches: batchDetails,
      reasonCode: 'RECIPE_COMPONENT_CALCULATED'
    };
    evaluated.push(componentResult);
    if (capacity === 0 && !decisiveZero) decisiveZero = componentResult;
  }

  if (!hasTrackedIngredient && !hasUnverified) {
    return result({
      verified: true,
      status: 'not_tracked',
      availableStock: null,
      reasonCode: 'RECIPE_ALL_INGREDIENTS_UNTRACKED',
      components: evaluated
    });
  }

  if (decisiveZero) {
    return result({
      verified: true,
      status: 'out_of_stock',
      availableStock: 0,
      reasonCode: 'RECIPE_CAPACITY_ZERO',
      limiting: decisiveZero,
      components: evaluated,
      diagnostics: Array.from(new Set(diagnostics))
    });
  }

  if (hasUnverified) {
    const priority = [
      'RECIPE_INGREDIENT_MISSING',
      'RECIPE_INGREDIENT_INACTIVE',
      'RECIPE_QUANTITY_INVALID',
      'RECIPE_UNIT_INCOMPATIBLE',
      'RECIPE_BATCH_READ_FAILED',
      'RECIPE_STOCK_INVALID'
    ];
    const reasonCode = priority.find((code) => diagnostics.includes(code))
      || 'RECIPE_UNVERIFIED';
    return result({
      verified: false,
      status: 'unverified',
      availableStock: null,
      reasonCode,
      components: evaluated,
      diagnostics: Array.from(new Set(diagnostics))
    });
  }

  const tracked = evaluated.filter((component) => (
    component.tracked === true && component.verified === true
  ));
  if (tracked.length === 0) {
    return result({
      verified: true,
      status: 'not_tracked',
      availableStock: null,
      reasonCode: 'RECIPE_ALL_INGREDIENTS_UNTRACKED',
      components: evaluated
    });
  }

  const limiting = tracked.reduce((current, component) => (
    !current || component.capacity < current.capacity ? component : current
  ), null);
  const availableStock = Math.max(0, limiting.capacity);

  return result({
    verified: true,
    status: availableStock > 0 ? 'in_stock' : 'out_of_stock',
    availableStock,
    reasonCode: 'RECIPE_CAPACITY_CALCULATED',
    limiting,
    components: evaluated
  });
};

export const ecommerceRecipeAvailabilityInternals = Object.freeze({
  EPSILON,
  getInventoryUnit,
  getRecipeUnit,
  getRawStockState,
  getEligibleBatchStock,
  isBatchManaged,
  isInactive
});
