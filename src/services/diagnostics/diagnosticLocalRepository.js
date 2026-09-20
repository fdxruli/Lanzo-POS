import { db, STORES } from '../db/dexie';

const readStore = async (storeName) => {
  try {
    if (!db.isOpen()) await db.open();
    return await db.table(storeName).toArray();
  } catch {
    return [];
  }
};

/**
 * Reads only local, tenant-scoped supplements that are not part of the
 * dashboard report payload. This repository never writes and never touches
 * Caja, sales, or financial tables.
 */
export const diagnosticLocalRepository = {
  async getInventorySupplements() {
    const [batches, inventoryEvents] = await Promise.all([
      readStore(STORES.PRODUCT_BATCHES),
      readStore(STORES.INVENTORY_EVENTS)
    ]);

    return { batches, inventoryEvents };
  }
};

export default diagnosticLocalRepository;
