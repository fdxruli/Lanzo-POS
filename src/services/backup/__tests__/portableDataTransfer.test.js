/* @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';
import {
  PORTABLE_DATA_FORMAT,
  PORTABLE_DATA_VERSION,
  PORTABLE_TRANSFER_TABLES,
  parseCsvDocument,
  portableDataTransferInternals
} from '../portableDataTransfer';

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
});
