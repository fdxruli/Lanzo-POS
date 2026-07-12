import { db, STORES } from '../db/dexie';

const PRODUCT_CHUNK_SIZE = 500;
const CATEGORY_CHUNK_SIZE = 500;
const BATCH_CHUNK_SIZE = 200;

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

export const createEcommercePublishedStockLocalSource = ({
  database = db,
  stores = STORES
} = {}) => ({
  async getProductsByIds(productIds = []) {
    return bulkGetByIds({
      database,
      store: stores.MENU,
      ids: uniqueIds(productIds),
      chunkSize: PRODUCT_CHUNK_SIZE
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
    const ids = uniqueIds(productIds);
    const batchesByProductId = new Map(ids.map((id) => [id, []]));
    if (ids.length === 0) return batchesByProductId;

    await ensureOpen(database);

    for (const idsChunk of chunk(ids, BATCH_CHUNK_SIZE)) {
      const batches = await database
        .table(stores.PRODUCT_BATCHES)
        .where('productId')
        .anyOf(idsChunk)
        .toArray();

      batches.forEach((batch) => {
        const productId = String(batch?.productId || batch?.product_id || '');
        if (!productId) return;
        const current = batchesByProductId.get(productId) || [];
        current.push(batch);
        batchesByProductId.set(productId, current);
      });
    }

    return batchesByProductId;
  }
});

export const ecommercePublishedStockLocalSource = createEcommercePublishedStockLocalSource();

export const ecommercePublishedStockLocalSourceInternals = Object.freeze({
  uniqueIds,
  chunk,
  bulkGetByIds
});
