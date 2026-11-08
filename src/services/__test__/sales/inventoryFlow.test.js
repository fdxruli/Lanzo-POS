import { describe, expect, it } from 'vitest';
import {
  buildProcessedItemsAndDeductions,
  commitStock,
  releaseCommittedStock
} from '../../sales/inventoryFlow';

const STORES = {
  MENU: 'menu',
  PRODUCT_BATCHES: 'product_batches'
};

const createFakeDb = ({ products = [], batches = [] } = {}) => {
  const menuMap = new Map(products.map((product) => [product.id, structuredClone(product)]));
  const batchMap = new Map(batches.map((batch) => [batch.id, structuredClone(batch)]));

  const tableFactory = (storeName) => {
    const backingMap = storeName === STORES.MENU ? menuMap : batchMap;

    return {
      get: async (id) => backingMap.get(id) || null,
      put: async (record) => {
        backingMap.set(record.id, structuredClone(record));
        return record.id;
      },
      bulkPut: async (records) => {
        records.forEach((record) => backingMap.set(record.id, structuredClone(record)));
        return records.map((record) => record.id);
      },
      bulkGet: async (ids) => ids.map((id) => backingMap.get(id) || null),
      where: (field) => ({
        equals: (value) => ({
          toArray: async () => Array.from(backingMap.values()).filter((record) => record?.[field] === value)
        })
      })
    };
  };

  return {
    transaction: async (_mode, _tables, callback) => callback(),
    table: (storeName) => tableFactory(storeName),
    __menu: menuMap,
    __batches: batchMap
  };
};

describe('inventoryFlow committed stock', () => {
  it('reserva st¶»§q«^