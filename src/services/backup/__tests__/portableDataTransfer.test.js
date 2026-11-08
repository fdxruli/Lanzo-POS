/* @vitest-environment jsdom */

import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PORTABLE_DATA_FORMAT,
  PORTABLE_DATA_VERSION,
  PORTABLE_TRANSFER_TABLES,
  importCatalogTransfer,
  importProductCsv,
  parseCsvDocument,
  previewCatalogTransfer,
  previewProductCsvImport,
  portableDataTransferInternals
} from '../portableDataTransfer';
import { closeTenantRuntime, openTenantRuntime } from '../../db/tenantRuntimeRouter';
import { STORES } from '../../db/dexie';
import { localTenantAccessController } from '../../tenant/localTenantPolicy';

const emptyDestination = () => ({
  categories: [],
  products: [],
  customers: [],
  images: [],
  ingredients: []
});

const catalogBundle = () => ({
  format: PORTABLE_DATA_FORMAT,
  version: PORTABLE_DATA_VERSION,
  dataKind: 'catalog-transfer',
  datasetId: 'dataset-1',
  tableCounts: Object.fromEntries(PORTABLE_TRANSFER_TABLES.map((name) => [name, 1])),
  transfer: {
    datasetId: 'dataset-1',
    tables: [...PORTABLE_TRANSFER_TABLES],
    catalogVariants: {
      'product-source': [{ talla: 'M', color: 'Azul', sku: 'CAM-M-AZ', price: 225 }]
    }
  },
  data: {
    tables: {
      categories: [{ id: 'category-source', name: 'Ropa' }],
      menu: [{
        id: 'product-source', name: 'Camisa', barcode: '7500001', categoryId: 'category-source',
        price: 250, cost: 80, stock: 12, committedStock: 2,
        recipe: [{ ingredientId: 'ingredient-source', quantity: 2 }]
      }],
      customers: [{ id: 'customer-source', name: 'Ana Pérez', phone: '5512345678', debt: 900, address: 'Centro' }],
      images: [{ id: 'image-source', blob: { __lanzoBinary: true, data: 'AQ==', type: 'image/png' } }],
      ingredients: [{ id: 'ingredient-source', name: 'Tela', stock: 10, cost: 30 }]
    }
  }
});

describe('portableDataTransfer', () => {
  const {
    buildCatalogTransferPlan,
    buildCsvImportPlan,
    formulaSafeCell,
    getPortableTables,
    portableTransferRow,
    buildTransferCatalogVariants
  } = portableDataTransferInternals;
  let activeDatabaseName = null;

  afterEach(async () => {
    closeTenantRuntime();
    localTenantAccessController.reset();
    if (activeDatabaseName) await Dexie.delete(activeDatabaseName);
    activeDatabaseName = null;
  });

  const activateTestBusiness = async () => {
    const alias = `license-id:portable-import-${crypto.randomUUID()}`;
    const identity = { primary: alias, aliases: [alias] };
    localTenantAccessController.grant(identity, 'portable-import-test');
    const runtime = await openTenantRuntime(identity);
    activeDatabaseName = runtime.database.name;
    return runtime.database;
  };

  it('parses quoted commas, accents and newlines in CSV cells', () => {
    expect(parseCsvDocument('nombre,descripción\r\n"Camisa, azul","Línea uno\nLínea dos con acento: á"'))
      .toEqual([
        ['nombre', 'descripción'],
        ['Camisa, azul', 'Línea uno\nLínea dos con acento: á']
      ]);
  });

  it('quotes CSV values and neutralizes formula prefixes', () => {
    expect(formulaSafeCell('=HYPERLINK("https://bad.example")'))
      .toBe('"\'=HYPERLINK(""https://bad.example"")"');
    expect(formulaSafeCell(125.5)).toBe('125.5');
  });

  it('limits transfer projections to master data and leaves money and stock out', () => {
    expect(portableTransferRow('menu', {
      id: 'p1', name: 'Camisa', price: 200, cost: 90, stock: 4,
      license_key: 'secret', device_id: 'device-secret'
    })).toEqual({ id: 'p1', name: 'Camisa', price: 200 });
    expect(portableTransferRow('customers', {
      id: 'c1', name: 'Ana', phone: '5512345678', debt: 500, creditLimit: 1000,
      license_key: 'secret'
    })).toEqual({ id: 'c1', name: 'Ana', phone: '5512345678' });
  });

  it('builds a tenant-local ID map for product, category and recipe references', async () => {
    const bundle = catalogBundle();
    const plan = await buildCatalogTransferPlan(bundle, emptyDestination());

    expect(plan.summary.products.create).toBe(1);
    expect(plan.summary.customers.create).toBe(1);
    expect(plan.summary.categories.create).toBe(1);
    expect(plan.summary.excludedTableCounts).toEqual({});
    expect(plan.categoryIdMap.get('category-source')).toMatch(/^transfer-category-/);
    expect(plan.productIdMap.get('product-source')).toMatch(/^transfer-product-/);
    expect(plan.ingredientIdMap.get('ingredient-source')).toMatch(/^transfer-ingredient-/);
    expect(plan.newProducts[0].variants).toEqual([
      { talla: 'M', color: 'Azul', sku: 'CAM-M-AZ', price: 225 }
    ]);
  });

  it('repeated import of the same package resolves markers instead of creating duplicates', async () => {
    const bundle = catalogBundle();
    const first = await buildCatalogTransferPlan(bundle, emptyDestination());
    const destination = {
      categories: first.categoryCreates,
      products: first.newProducts.map((item) => ({
        id: item.targetId,
        name: item.source.name,
        barcode: item.source.barcode,
        stock: 0,
        committedStock: 0,
        transferSourceKey: item.marker
      })),
      customers: first.customerCreates.map((item) => ({
        id: item.targetId,
        name: item.source.name,
        phone: item.source.phone,
        metadata: { portabilitySourceKey: item.marker }
      })),
      images: first.imageCreates.map(({ source, targetId, marker }) => ({ id: targetId, transferSourceKey: marker, blob: source.blob })),
      ingredients: first.ingredientCreates.map(({ source, targetId, marker }) => ({ id: targetId, name: source.name, transferSourceKey: marker }))
    };
    const repeated = await buildCatalogTransferPlan(bundle, destination);

    expect(repeated.newProducts).toHaveLength(0);
    expect(repeated.categoryCreates).toHaveLength(0);
    expect(repeated.productUpdates).toHaveLength(1);
    expect(repeated.customerCreates).toHaveLength(0);
    expect(repeated.customerDuplicates).toHaveLength(1);
    expect(repeated.reviewToken).not.toBe(first.reviewToken);
  });

  it('detects a destination inventory edit before an import is confirmed', async () => {
    const bundle = catalogBundle();
    const first = await buildCatalogTransferPlan(bundle, emptyDestination());
    const changed = await buildCatalogTransferPlan(bundle, {
      ...emptyDestination(),
      products: [{ id: 'existing-product', name: 'Other', barcode: 'other', stock: 7, committedStock: 0 }]
    });
    expect(changed.reviewToken).not.toBe(first.reviewToken);
  });

  it('rejects a file that omits one of the declared catalog transfer tables', () => {
    const bundle = catalogBundle();
    delete bundle.data.tables.images;
    expect(() => getPortableTables(bundle)).toThrow(/todas las tablas necesarias/);
  });

  it('exports only the attributes and sale prices needed to rebuild apparel variants', () => {
    expect(buildTransferCatalogVariants([
      { productId: 'shirt', stock: 3, cost: 45, price: 200, sku: 'M-B', attributes: { talla: 'M', color: 'Blue' } },
      { productId: 'shirt', stock: 2, cost: 50, price: 200, sku: 'M-B', attributes: { talla: 'M', color: 'Blue' } }
    ])).toEqual({
      shirt: [{ talla: 'M', color: 'Blue', sku: 'M-B', price: 200 }]
    });
  });

  it('rejects repeat CSV rows that conflict with a product marker', async () => {
    const csv = 'id,name,price,barcode\np1,Producto distinto,20,7500009';
    const plan = await buildCsvImportPlan(csv, {
      existingProducts: [{ id: 'local-1', name: 'Producto original', barcode: '7500001', transferSourceKey: 'csv:id:p1' }],
      existingCategories: []
    });
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.accepted).toHaveLength(0);
  });

  it('treats a repeated CSV product as an update without another initial inventory batch', async () => {
    const csv = 'id,name,price,barcode,stock,cost\np1,Producto,20,7500009,5,3';
    const plan = await buildCsvImportPlan(csv, {
      existingProducts: [{
        id: 'local-1', name: 'Producto', barcode: '7500009', stock: 7,
        committedStock: 2, cost: 4, transferSourceKey: 'csv:id:p1'
      }],
      existingCategories: []
    });
    expect(plan.updates).toHaveLength(1);
    expect(plan.accepted).toHaveLength(0);
    expect(plan.summary.initialInventoryProducts).toBe(0);
  });

  it('imports CSV against IndexedDB, is idempotent on retry, and rolls back all writes on failure', async () => {
    const database = await activateTestBusiness();
    const csv = 'id,name,price,barcode,stock,cost,category\nitem-1,Café molido,15,7500001,5,4,Café';
    const preview = await previewProductCsvImport(csv);
    expect(preview.summary).toMatchObject({ create: 1, categoriesCreated: 1, initialInventoryProducts: 1 });

    const first = await importProductCsv(csv);
    expect(first).toMatchObject({ importedCount: 1, updatedCount: 0 });
    const product = (await database.table(STORES.MENU).toArray())[0];
    const batch = (await database.table(STORES.PRODUCT_BATCHES).toArray())[0];
    expect(product).toMatchObject({ name: 'Café molido', stock: 5, transferSourceKey: 'csv:id:item-1' });
    expect(batch).toMatchObject({ productId: product.id, stock: 5, cost: 4 });
    expect(await database.table(STORES.CATEGORIES).count()).toBe(1);

    const second = await importProductCsv(csv);
    expect(second).toMatchObject({ importedCount: 0, updatedCount: 1, summary: { initialInventoryProducts: 0 } });
    expect(await database.table(STORES.MENU).count()).toBe(1);
    expect(await database.table(STORES.PRODUCT_BATCHES).count()).toBe(1);
    expect((await database.table(STORES.MENU).get(product.id)).stock).toBe(5);

    const menuTable = database.table(STORES.MENU);
    const failProductCreate = (_key, row) => {
      if (row.name === 'Rollback trigger') throw new Error('simulated product validation failure');
    };
    menuTable.hook('creating', failProductCreate);
    try {
      const rollbackCsv = 'id,name,price,barcode,stock,cost,category\nitem-2,First product,20,7500002,2,8,New category\nitem-3,Rollback trigger,25,7500003,3,10,New category';
      await expect(importProductCsv(rollbackCsv)).rejects.toThrow();
    } finally {
      menuTable.hook('creating').unsubscribe(failProductCreate);
    }

    expect(await database.table(STORES.CATEGORIES).count()).toBe(1);
    expect(await database.table(STORES.MENU).count()).toBe(1);
    expect(await database.table(STORES.PRODUCT_BATCHES).count()).toBe(1);
    expect(await database.table(STORES.CATEGORIES).where('name').equals('New category').count()).toBe(0);
  });

  it('imports catalog transfer through IndexedDB and keeps the second attempt idempotent', async () => {
    const database = await activateTestBusiness();
    const bundle = {
      format: PORTABLE_DATA_FORMAT,
      version: PORTABLE_DATA_VERSION,
      dataKind: 'catalog-transfer',
      datasetId: 'indexeddb-catalog-dataset',
      tableCounts: { categories: 1, menu: 1, customers: 0, images: 1, ingredients: 1 },
      transfer: {
        datasetId: 'indexeddb-catalog-dataset',
        tables: [...PORTABLE_TRANSFER_TABLES],
        catalogVariants: { 'source-shirt': [{ talla: 'M', color: 'Azul', sku: 'SHIRT-M-AZ', price: 225 }] }
      },
      data: { tables: {
        categories: [{ id: 'source-category', name: 'Ropa' }],
        menu: [{
          id: 'source-shirt', name: 'Camisa', barcode: '7500100', categoryId: 'source-category',
          price: 250, cost: 80, stock: 12, committedStock: 2, image: 'source-image',
          trackStock: true, batchManagement: { enabled: true, selectionStrategy: 'fifo' },
          recipe: [{ ingredientId: 'source-ingredient', quantity: 1 }]
        }],
        customers: [],
        images: [{ id: 'source-image', blob: { __lanzoBinary: true, data: 'AQ==', type: 'image/png' }, type: 'image/png' }],
        ingredients: [{ id: 'source-ingredient', name: 'Tela', unit: 'm', isActive: true }]
      } }
    };

    const preview = await previewCatalogTransfer(bundle);
    expect(preview.summary).toMatchObject({
      categories: { create: 1 },
      products: { create: 1 },
      images: { create: 1 },
      ingredients: { create: 1 }
    });
    await importCatalogTransfer(bundle, preview);
    expect({
      categories: await database.table(STORES.CATEGORIES).count(),
      products: await database.table(STORES.MENU).count(),
      images: await database.table(STORES.IMAGES).count(),
      ingredients: await database.table(STORES.INGREDIENTS).count(),
      batches: await database.table(STORES.PRODUCT_BATCHES).count()
    }).toEqual({ categories: 1, products: 1, images: 1, ingredients: 1, batches: 1 });
    const importedProduct = (await database.table(STORES.MENU).toArray())[0];
    expect(importedProduct).toMatchObject({ stock: 0, cost: 0, transferSourceKey: 'indexeddb-catalog-dataset:menu:source-shirt' });

    const secondPreview = await previewCatalogTransfer(bundle);
    expect(secondPreview.summary.products).toMatchObject({ create: 0, update: 1 });
    await importCatalogTransfer(bundle, secondPreview);
    expect(await database.table(STORES.CATEGORIES).count()).toBe(1);
    expect(await database.table(STORES.MENU).count()).toBe(1);
    expect(await database.table(STORES.IMAGES).count()).toBe(1);
    expect(await database.table(STORES.INGREDIENTS).count()).toBe(1);
    expect(await database.table(STORES.PRODUCT_BATCHES).count()).toBe(1);

    const rollbackBundle = {
      ...bundle,
      datasetId: 'indexeddb-catalog-rollback',
      tableCounts: { categories: 1, menu: 2, customers: 0, images: 1, ingredients: 1 },
      transfer: {
        ...bundle.transfer,
        datasetId: 'indexeddb-catalog-rollback',
        catalogVariants: {}
      },
      data: { tables: {
        categories: [{ id: 'rollback-category', name: 'Rollback category' }],
        menu: [
          { id: 'rollback-first', name: 'First product', categoryId: 'rollback-category', price: 20, recipe: [] },
          { id: 'rollback-trigger', name: 'Rollback trigger', categoryId: 'rollback-category', price: 25, recipe: [] }
        ],
        customers: [],
        images: [{ id: 'rollback-image', blob: { __lanzoBinary: true, data: 'AQ==', type: 'image/png' } }],
        ingredients: [{ id: 'rollback-ingredient', name: 'Rollback ingredient' }]
      } }
    };
    const menuTable = database.table(STORES.MENU);
    const failProductCreate = (_key, row) => {
      if (row.name === 'Rollback trigger') throw new Error('simulated product validation failure');
    };
    menuTable.hook('creating', failProductCreate);
    try {
      await expect(importCatalogTransfer(rollbackBundle)).rejects.toThrow();
    } finally {
      menuTable.hook('creating').unsubscribe(failProductCreate);
    }
    expect(await database.table(STORES.CATEGORIES).count()).toBe(1);
    expect(await database.table(STORES.MENU).count()).toBe(1);
    expect(await database.table(STORES.IMAGES).count()).toBe(1);
    expect(await database.table(STORES.INGREDIENTS).count()).toBe(1);
    expect(await database.table(STORES.PRODUCT_BATCHES).count()).toBe(1);
  });
});
