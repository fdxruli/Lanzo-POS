/* @vitest-environment jsdom */

import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PORTABLE_DATA_FORMAT,
  PORTABLE_DATA_VERSION,
  PORTABLE_TRANSFER_TABLES,
  createPortableDataBundle,
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

const catalogBundleWith = ({ categories, menu } = {}) => {
  const bundle = catalogBundle();
  if (categories) bundle.data.tables.categories = categories;
  if (menu) bundle.data.tables.menu = menu;
  bundle.tableCounts.categories = bundle.data.tables.categories.length;
  bundle.tableCounts.menu = bundle.data.tables.menu.length;
  return bundle;
};

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
    expect(portableTransferRow('categories', {
      id: 'cat-1', name: 'QA Bebidas', color: '#2563eb', isActive: true, sortOrder: 3,
      createdAt: 'ignored'
    })).toEqual({ id: 'cat-1', name: 'QA Bebidas', color: '#2563eb', isActive: true, sortOrder: 3 });
  });

  it('exports category color and display order in a catalog-transfer package', async () => {
    const database = await activateTestBusiness();
    await database.table(STORES.CATEGORIES).bulkPut([
      { id: 'qa-beverages', name: 'QA Bebidas', color: '#2563eb', isActive: true, sortOrder: 3 },
      { id: 'qa-snacks', name: 'QA Botanas', color: '#f97316', isActive: true, sortOrder: 7 }
    ]);

    const bundle = await createPortableDataBundle({ transferOnly: true });

    expect(bundle.dataKind).toBe('catalog-transfer');
    expect(bundle.data.tables.categories).toEqual([
      { id: 'qa-beverages', name: 'QA Bebidas', color: '#2563eb', isActive: true, sortOrder: 3 },
      { id: 'qa-snacks', name: 'QA Botanas', color: '#f97316', isActive: true, sortOrder: 7 }
    ]);
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

  it('preserves valid category color and sort order, with compatible defaults for older packages', async () => {
    const bundle = catalogBundleWith({
      categories: [
        { id: 'beverages', name: 'QA Bebidas', color: '#2563eb', sortOrder: 3 },
        { id: 'snacks', name: 'QA Botanas', color: '#f97316', sortOrder: 7 }
      ],
      menu: []
    });
    const plan = await buildCatalogTransferPlan(bundle, emptyDestination());

    expect(plan.categoryCreates).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'QA Bebidas', color: '#2563eb', sortOrder: 3 }),
      expect.objectContaining({ name: 'QA Botanas', color: '#f97316', sortOrder: 7 })
    ]));
    expect(plan.conflicts).toHaveLength(0);

    const legacy = catalogBundleWith({ categories: [{ id: 'legacy-category', name: 'Legacy' }], menu: [] });
    const legacyPlan = await buildCatalogTransferPlan(legacy, emptyDestination());
    expect(legacyPlan.categoryCreates[0]).toMatchObject({ color: '#cccccc', sortOrder: 0 });
    expect(legacyPlan.conflicts).toHaveLength(0);
  });

  it.each([
    ['Bebidas', ' bebidas '],
    ['bebidas', 'BEBIDAS'],
    ['Café molido', 'Café   molido']
  ])('matches Free-equivalent category names conservatively (%s / %s)', async (sourceName, destinationName) => {
    const bundle = catalogBundleWith({ categories: [{ id: 'category-source', name: sourceName }] });
    const destination = {
      ...emptyDestination(),
      categories: [{ id: 'category-destination', name: destinationName, color: '#112233', sortOrder: 11 }]
    };

    const plan = await buildCatalogTransferPlan(bundle, destination);

    expect(plan.categoryCreates).toHaveLength(0);
    expect(plan.categoryIdMap.get('category-source')).toBe('category-destination');
    expect(plan.conflicts).toHaveLength(0);
  });

  it('does not fold accents and blocks ambiguous category matches instead of choosing one', async () => {
    const accented = await buildCatalogTransferPlan(
      catalogBundleWith({ categories: [{ id: 'category-source', name: 'Café' }] }),
      { ...emptyDestination(), categories: [{ id: 'plain-cafe', name: 'Cafe' }] }
    );
    expect(accented.categoryCreates).toHaveLength(1);
    expect(accented.categoryIdMap.get('category-source')).not.toBe('plain-cafe');

    const ambiguous = await buildCatalogTransferPlan(
      catalogBundleWith({ categories: [{ id: 'category-source', name: 'Bebidas' }] }),
      { ...emptyDestination(), categories: [
        { id: 'drinks-one', name: 'Bebidas' },
        { id: 'drinks-two', name: ' bebidas ' }
      ] }
    );
    expect(ambiguous.categoryIdMap.has('category-source')).toBe(false);
    expect(ambiguous.conflicts.join(' ')).toMatch(/varias coincidencias/);

    const duplicateSourceNames = await buildCatalogTransferPlan(
      catalogBundleWith({ categories: [
        { id: 'source-one', name: 'Bebidas' },
        { id: 'source-two', name: ' bebidas ' }
      ] }),
      emptyDestination()
    );
    expect(duplicateSourceNames.conflicts.join(' ')).toMatch(/nombres ambiguos/);
  });

  it('rejects invalid new category presentation attributes and missing category references', async () => {
    const invalidColor = await buildCatalogTransferPlan(
      catalogBundleWith({ categories: [{ id: 'category-source', name: 'Bebidas', color: 'url(javascript:alert(1))', sortOrder: 3 }] }),
      emptyDestination()
    );
    expect(invalidColor.categoryCreates).toHaveLength(0);
    expect(invalidColor.conflicts.join(' ')).toMatch(/color no es válido/);

    const invalidOrder = await buildCatalogTransferPlan(
      catalogBundleWith({ categories: [{ id: 'category-source', name: 'Bebidas', color: '#2563eb', sortOrder: 'later' }] }),
      emptyDestination()
    );
    expect(invalidOrder.categoryCreates).toHaveLength(0);
    expect(invalidOrder.conflicts.join(' ')).toMatch(/orden no es válido/);

    const missingReferenceBundle = catalogBundle();
    missingReferenceBundle.data.tables.menu[0].categoryId = 'category-not-in-file';
    const missingReference = await buildCatalogTransferPlan(missingReferenceBundle, emptyDestination());
    expect(missingReference.conflicts.join(' ')).toMatch(/no se encontró su categoría de origen/);

    const uncategorizedBundle = catalogBundle();
    uncategorizedBundle.data.tables.menu[0].categoryId = '';
    const uncategorized = await buildCatalogTransferPlan(uncategorizedBundle, emptyDestination());
    expect(uncategorized.conflicts).toHaveLength(0);
    expect(uncategorized.newProducts).toHaveLength(1);
    expect(uncategorized.newProducts[0].source.categoryId).toBe('');
  });

  it('reuses destination category preferences and maps products to the destination ID', async () => {
    const database = await activateTestBusiness();
    await database.table(STORES.CATEGORIES).put({
      id: 'destination-beverages', name: ' bebidas ', color: '#112233', isActive: true, sortOrder: 11
    });
    const bundle = catalogBundleWith({
      categories: [{ id: 'source-beverages', name: 'BEBIDAS', color: '#2563eb', sortOrder: 3 }],
      menu: [{ id: 'source-drink', name: 'Refresco', barcode: '7501001', price: 15, categoryId: 'source-beverages' }]
    });

    const preview = await previewCatalogTransfer(bundle);
    expect(preview.summary.categories).toMatchObject({ create: 0, reuse: 1 });
    await importCatalogTransfer(bundle, preview);

    expect(await database.table(STORES.CATEGORIES).toArray()).toEqual([
      { id: 'destination-beverages', name: ' bebidas ', color: '#112233', isActive: true, sortOrder: 11 }
    ]);
    const importedProduct = (await database.table(STORES.MENU).toArray())[0];
    expect(importedProduct.categoryId).toBe('destination-beverages');
  });

  it('exports and imports multiple category associations across businesses, idempotently', async () => {
    const sourceDatabase = await activateTestBusiness();
    await sourceDatabase.table(STORES.CATEGORIES).bulkPut([
      { id: 'source-beverages', name: 'QA Bebidas', color: '#2563eb', isActive: true, sortOrder: 3 },
      { id: 'source-snacks', name: 'QA Botanas', color: '#f97316', isActive: true, sortOrder: 7 }
    ]);
    await sourceDatabase.table(STORES.MENU).bulkPut([
      { id: 'source-drink', name: 'QA Refresco', barcode: '7502001', price: 15, categoryId: 'source-beverages', isActive: true },
      { id: 'source-chips', name: 'QA Papas', barcode: '7502002', price: 20, categoryId: 'source-snacks', isActive: true }
    ]);
    const bundle = await createPortableDataBundle({ transferOnly: true });
    const sourceDatabaseName = activeDatabaseName;
    closeTenantRuntime();
    await Dexie.delete(sourceDatabaseName);
    activeDatabaseName = null;

    const destinationDatabase = await activateTestBusiness();
    expect(destinationDatabase.name).not.toBe(sourceDatabaseName);
    const preview = await previewCatalogTransfer(bundle);
    expect(preview.summary).toMatchObject({ categories: { create: 2 }, products: { create: 2 } });
    await importCatalogTransfer(bundle, preview);

    const importedCategories = await destinationDatabase.table(STORES.CATEGORIES).toArray();
    const categoriesByName = new Map(importedCategories.map((category) => [category.name, category]));
    expect(categoriesByName.get('QA Bebidas')).toMatchObject({ color: '#2563eb', sortOrder: 3 });
    expect(categoriesByName.get('QA Botanas')).toMatchObject({ color: '#f97316', sortOrder: 7 });
    const importedProducts = await destinationDatabase.table(STORES.MENU).toArray();
    const productsByName = new Map(importedProducts.map((product) => [product.name, product]));
    expect(productsByName.get('QA Refresco').categoryId).toBe(categoriesByName.get('QA Bebidas').id);
    expect(productsByName.get('QA Papas').categoryId).toBe(categoriesByName.get('QA Botanas').id);
    expect(importedProducts.every(({ id }) => id.startsWith('transfer-product-'))).toBe(true);
    expect(importedCategories.some(({ id }) => id === 'source-beverages' || id === 'source-snacks')).toBe(false);

    const repeatedPreview = await previewCatalogTransfer(bundle);
    expect(repeatedPreview.summary).toMatchObject({ categories: { create: 0 }, products: { create: 0, update: 2 } });
    await importCatalogTransfer(bundle, repeatedPreview);
    expect(await destinationDatabase.table(STORES.CATEGORIES).count()).toBe(2);
    expect(await destinationDatabase.table(STORES.MENU).count()).toBe(2);
  });

  it('shows invalid portable category data during review and writes nothing', async () => {
    const database = await activateTestBusiness();
    const bundle = catalogBundleWith({
      categories: [{ id: 'invalid-category', name: 'Bebidas', color: 'rgb(0 0 0)', sortOrder: 3 }],
      menu: [{ id: 'invalid-product', name: 'Refresco', barcode: '7503001', price: 15, categoryId: 'invalid-category' }]
    });

    const preview = await previewCatalogTransfer(bundle);
    expect(preview.conflicts.join(' ')).toMatch(/color no es válido/);
    await expect(importCatalogTransfer(bundle, preview)).rejects.toThrow('DATA_TRANSFER_CONFLICTS_REVIEW');
    expect(await database.table(STORES.CATEGORIES).count()).toBe(0);
    expect(await database.table(STORES.MENU).count()).toBe(0);
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
