import { db, STORES } from '../db/dexie';

export const BATCH_DIRECTORY_PAGE_SIZE = 16;

/**
 * Descubre productos con historial de lotes mediante el índice productId.
 * No lee todo el catálogo ni materializa todos los lotes. La lectura
 * completa de un producto queda reservada para cuando se selecciona.
 */
export async function queryBatchProductDirectoryPage({
  cursor = null,
  pageSize = BATCH_DIRECTORY_PAGE_SIZE
} = {}) {
  const size = Number.isInteger(pageSize) && pageSize > 0
    ? Math.min(pageSize, 50)
    : BATCH_DIRECTORY_PAGE_SIZE;
  const afterProductId = cursor ? String(cursor) : null;
  const table = db.table(STORES.PRODUCT_BATCHES);
  const collection = afterProductId
    ? table.where('productId').above(afterProductId)
    : table.orderBy('productId');

  const productIds = [];
  await collection
    .until(() => productIds.length >= size + 1)
    .eachUniqueKey((key) => {
      if (typeof key === 'string' && key) productIds.push(key);
    });

  const hasMore = productIds.length > size;
  const pageIds = productIds.slice(0, size);
  const products = await db.table(STORES.MENU).bulkGet(pageIds);
  const items = products.filter((product) => (
    Boolean(product?.id) && !product.deletedAt && !product.deletedTimestamp
  ));

  return {
    items,
    hasMore,
    nextCursor: hasMore ? pageIds.at(-1) : null
  };
}
