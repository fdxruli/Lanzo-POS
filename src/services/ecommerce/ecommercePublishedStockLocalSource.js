import { db, STORES } from '../db/dexie';
import { normalizeModifierGroups } from '../../utils/restaurantModifiers';

const PRODUCT_CHUNK_SIZE = 500;
const CATEGORY_CHUNK_SIZE = 500;
const BATCH_CHUNK_SIZE = 200;
const MAX_RECIPE_DEPTH = 3;
const ENRICHED_INGREDIENTS_KEY = '__ecommerceIngredients';

const uniqueIds = (values = []) => Array.from(new Set(
  values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
));

const chunk = (values, size) => {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
};

const ensureOpen = async (database) => {
  if (!database.isOpen()) await database.open();
};

const bulkGetByIds = async ({ database, store, ids, chunkSize }) => {
  const valuesById = new Map();
  if (ids.length === 0) return valuesById;
  await ensureOpen(database);

  for (const idsChunk of chunk(ids, chunkSize)) {
    const values = await database.table(store).bulkGet(idsChunk);
    values.forEach((value, index) => {
      if (value?.id) valuesById.set(String(idsChunk[index]), value);
    });
  }

  return valuesById;
};

const getRecipeIngredientIds = (product = {}) => uniqueIds(
  (Array.isArray(product.recipe) ? product.recipe : [])
    .map((component) => (
      component?.ingredientId
      ?? component?.ingredient_id
      ?? component?.productId
    ))
);

const normalizeProductForEcommerce = (product) => {
  if (!product || typeof product !== 'object') return product;
  if (!Array.isArray(product.modifiers)) return product;
  return {
    ...product,
    modifiers: normalizeModifierGroups(product.modifiers)
  };
};

const loadProductsWithRecipeDependencies = async ({
  database,
  store,
  ids,
  depth = MAX_RECIPE_DEPTH
}) => {
  const requestedIds = uniqueIds(ids);
  const productsById = await bulkGetByIds({
    database,
    store,
    ids: requestedIds,
    chunkSize: PRODUCT_CHUNK_SIZE
  });

  let frontier = requestedIds;
  for (let level = 0; level < depth; level += 1) {
    const dependencyIds = uniqueIds(
      frontier.flatMap((id) => getRecipeIngredientIds(productsById.get(id)))
    ).filter((id) => !productsById.has(id));
    if (dependencyIds.length === 0) break;

    const dependencies = await bulkGetByIds({
      database,
      store,
      ids: dependencyIds,
      chunkSize: PRODUCT_CHUNK_SIZE
    });
    dependencies.forEach((value, id) => productsById.set(id, value));
    frontier = dependencyIds;
  }

  productsById.forEach((product, id) => {
    productsById.set(id, normalizeProductForEcommerce(product));
  });

  requestedIds.forEach((id) => {
    const product = productsById.get(id);
    if (!product) return;
    const ingredients = getRecipeIngredientIds(product)
      .map((ingredientId) => productsById.get(ingredientId))
      .filter(Boolean);
    productsById.set(id, {
      ...product,
      [ENRICHED_INGREDIENTS_KEY]: ingredients
    });
  });

  return productsById;
};

const expandRecipeProductIds = async ({ database, store, ids }) => {
  const products = await loadProductsWithRecipeDependencies({
    database,
    store,
    ids
  });
  const expanded = new Set(uniqueIds(ids));
  uniqueIds(ids).forEach((id) => {
    getRecipeIngredientIds(products.get(id)).forEach((ingredientId) => {
      expanded.add(ingredientId);
    });
  });
  return { products, ids: Array.from(expanded) };
};

export const createEcommercePublishedStockLocalSource = ({
  database = db,
  stores = STORES
} = {}) => ({
  async getProductsByIds(productIds = []) {
    return loadProductsWithRecipeDependencies({
      database,
      store: stores.MENU,
      ids: uniqueIds(productIds)
    });
  },

  async getCategoriesByIds(categoryIds = []) {
    return bulkGetByIds({
      database,
      store: stores.CATEGORIES,
      ids: uniqueIds(categoryIds),
      chunkSize: CATEGORY_CHUNK_SIZE
    });
  },

  async getBatchesByProductIds(productIds = []) {
    const requestedIds = uniqueIds(productIds);
    const batchesByProductId = new Map(requestedIds.map((id) => [id, []]));
    if (requestedIds.length === 0) return batchesByProductId;

    await ensureOpen(database);
    const expanded = await expandRecipeProductIds({
      database,
      store: stores.MENU,
      ids: requestedIds
    });
    const directBatchesByProduct = new Map(expanded.ids.map((id) => [id, []]));

    for (const idsChunk of chunk(expanded.ids, BATCH_CHUNK_SIZE)) {
      const batches = await database
        .table(stores.PRODUCT_BATCHES)
        .where('productId')
        .anyOf(idsChunk)
        .toArray();

      batches.forEach((batch) => {
        const productId = String(batch?.productId || batch?.product_id || '');
        if (!productId) return;
        const current = directBatchesByProduct.get(productId) || [];
        current.push(batch);
        directBatchesByProduct.set(productId, current);
      });
    }

    requestedIds.forEach((id) => {
      const product = expanded.products.get(id);
      const ingredientIds = getRecipeIngredientIds(product);
      if (ingredientIds.length === 0) {
        batchesByProductId.set(id, directBatchesByProduct.get(id) || []);
        return;
      }
      const recipeBatches = ingredientIds.flatMap((ingredientId) => (
        directBatchesByProduct.get(ingredientId) || []
      ));
      batchesByProductId.set(id, recipeBatches);
    });

    return batchesByProductId;
  }
});

export const ecommercePublishedStockLocalSource = createEcommercePublishedStockLocalSource();

export const ecommercePublishedStockLocalSourceInternals = Object.freeze({
  uniqueIds,
  chunk,
  bulkGetByIds,
  getRecipeIngredientIds,
  normalizeProductForEcommerce,
  loadProductsWithRecipeDependencies,
  expandRecipeProductIds,
  ENRICHED_INGREDIENTS_KEY
});
