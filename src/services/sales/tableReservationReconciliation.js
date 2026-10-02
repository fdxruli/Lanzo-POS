import { getCommittedStock, normalizeStock } from '../inventoryStock';
import { getTableReservationProductQuantities } from './inventoryFlow';

/**
 * Call inside an rw transaction covering SALES, MENU and PRODUCT_BATCHES.
 * Physical stock comes from the catalog; temporary holds belong to this
 * device. Repair only a deficit backed by a persisted, still-open order.
 * Existing holds also cover the interval between commitStock and saving it.
 */
export const reconcileActiveTableReservations = async ({ db, STORES }) => {
  const orders = await db.table(STORES.SALES).where('status').equals('open').toArray();
  const products = await db.table(STORES.MENU).toArray();
  const batches = await db.table(STORES.PRODUCT_BATCHES).toArray();
  const productMap = new Map(products.map((product) => [product.id, product]));
  const batchMap = new Map(batches.map((batch) => [batch.id, batch]));
  const productFloors = new Map();
  const batchFloors = new Map();
  const add = (map, id, quantity) => {
    const normalizedQuantity = normalizeStock(quantity);
    if (id && normalizedQuantity > 0) map.set(id, normalizeStock((map.get(id) || 0) + normalizedQuantity));
  };

  for (const order of orders) {
    if (order.splitReservationReconciledAt) continue;
    for (const item of order.items || []) {
      const reservation = item.inventoryReservation;
      if (reservation?.source !== 'table' || !(reservation.committedQuantity > 0)) continue;
      const product = productMap.get(item.parentId || item.id);
      for (const usage of reservation.committedBatches || []) {
        if (usage.quantity > 0 && !batchMap.has(usage.batchId)) {
          throw new Error(`CRITICAL_BATCH_NOT_FOUND: No existe el lote ${usage.batchId}.`);
        }
        add(batchFloors, usage.batchId, usage.quantity);
      }
      for (const usage of getTableReservationProductQuantities(item, product)) {
        if (usage.quantity > 0 && !productMap.has(usage.productId)) {
          throw new Error(`CRITICAL_PRODUCT_NOT_FOUND: No existe el producto ${usage.productId}.`);
        }
        add(productFloors, usage.productId, usage.quantity);
      }
    }
  }

  const changedBatches = [];
  const parentTotals = new Map();
  for (const batch of batches) {
    const committed = Math.max(getCommittedStock(batch), batchFloors.get(batch.id) || 0);
    if (committed !== getCommittedStock(batch)) {
      batch.committedStock = committed;
      changedBatches.push(batch);
    }
    add(parentTotals, batch.productId, committed);
    // Include parents whose aggregate legitimately becomes zero.
    if (!parentTotals.has(batch.productId)) parentTotals.set(batch.productId, 0);
  }

  const changedProducts = [];
  for (const product of products) {
    const committed = product.batchManagement?.enabled && parentTotals.has(product.id)
      ? normalizeStock(parentTotals.get(product.id) + (productFloors.get(product.id) || 0))
      : Math.max(getCommittedStock(product), productFloors.get(product.id) || 0);
    if (committed !== getCommittedStock(product)) {
      product.committedStock = committed;
      changedProducts.push(product);
    }
  }
  if (changedBatches.length) await db.table(STORES.PRODUCT_BATCHES).bulkPut(changedBatches);
  if (changedProducts.length) await db.table(STORES.MENU).bulkPut(changedProducts);
};
