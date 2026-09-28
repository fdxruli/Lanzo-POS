import { describe, expect, it } from 'vitest';
import { buildAssortmentAnalysis } from '../assortmentAnalytics';

const completeMetadata = {
  paginationComplete: true,
  sourceComplete: true,
  detailComplete: true,
  historyTruncated: false,
  detailTruncated: false
};

const dataset = (items = [], metadata = completeMetadata) => ({
  history: { rows: items.length ? [{ items }] : [] },
  metadata
});

const catalog = (products, categories, overrides = {}) => ({
  products,
  categories,
  complete: true,
  productsTruncated: false,
  categoriesTruncated: false,
  ...overrides
});

describe('assortment analytics', () => {
  it('joins stable product ids, flags duplicate-name fallback as ambiguous and summarizes catalogue health', () => {
    const products = [
      { id: 'p1', name: 'Café', categoryId: 'c1', isActive: true, stock: 99, unit_cost: 0 },
      { id: 'p2', name: 'Cafe', categoryId: 'c1', isActive: true, stock: 0, unit_cost: null },
      { id: 'p3', name: 'Té', categoryId: 'c2', isActive: true },
      { id: 'p4', name: 'Nuevo', categoryId: 'c1', isActive: true },
      { id: 'p5', name: 'Baja', categoryId: 'gone', isActive: true }
    ];
    const categories = [
      { id: 'c1', name: 'Bebidas', isActive: true },
      { id: 'c2', name: 'Tés', isActive: true },
      { id: 'c3', name: 'Sin venta', isActive: true },
      { id: 'deleted', name: 'Eliminada', isActive: false, deletedAt: '2026-01-01' }
    ];
    const current = dataset([
      { productId: 'p1', name: 'Café', quantity: 2, total: 100 },
      { productId: 'p3', name: 'Té', quantity: 1, total: 20 },
      { name: 'Cafe', quantity: 1, total: 5, id: 'sale-line-id' },
      { productId: 'p5', name: 'Baja', quantity: 1, total: 10 }
    ]);
    const previous = dataset([
      { productId: 'p1', name: 'Café', quantity: 1, total: 50 },
      { productId: 'p2', name: 'Cafe', quantity: 2, total: 40 },
      { productId: 'p2', name: 'Cafe', quantity: 1, total: 10 },
      { productId: 'p5', name: 'Baja', quantity: 1, total: 30 }
    ]);

    const result = buildAssortmentAnalysis({ catalog: catalog(products, categories), currentDataset: current, previousDataset: previous });
    const currentProducts = result.dormantProducts.reduce((byName, row) => ({ ...byName, [row.name]: row }), {});

    expect(result.health).toMatchObject({
      activeCatalogProducts: 5,
      soldProducts: 3,
      unsoldProducts: 2,
      activeCategories: 3,
      currentSalesCoverageComplete: true,
      previousComparisonAvailable: true
    });
    expect(result.reactivationCandidates).toContainEqual(expect.objectContaining({
      name: 'Cafe',
      currentSales: 0,
      previousSales: 50,
      availability: 'availability_unknown'
    }));
    expect(currentProducts.Té).toMatchObject({ activity: 'low_activity', currentUnits: 1 });
    expect(currentProducts.Nuevo).toMatchObject({ activity: 'never_sold_in_window', availability: 'availability_unknown' });
    expect(result.limitations.some((item) => /coincide con varios productos/i.test(item))).toBe(true);
    expect(result.limitations.some((item) => /categoría vigente verificable/i.test(item))).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/"(?:stock|unit_cost|cost|margin|profit)"/u);
    expect(result.dormantProducts.every((row) => !('id' in row))).toBe(true);
  });

  it('calculates category sales, concentration and comparable growth/decline only with complete data', () => {
    const products = [
      { id: 'a1', name: 'A1', categoryId: 'a' },
      { id: 'a2', name: 'A2', categoryId: 'a' },
      { id: 'a3', name: 'A3', categoryId: 'a' },
      { id: 'b1', name: 'B1', categoryId: 'b' },
      { id: 'b2', name: 'B2', categoryId: 'b' }
    ];
    const categories = [
      { id: 'a', name: 'Categoría A' },
      { id: 'b', name: 'Categoría B' }
    ];
    const current = dataset([
      { productId: 'a1', name: 'A1', quantity: 4, total: 80 },
      { productId: 'a2', name: 'A2', quantity: 2, total: 20 },
      { productId: 'b1', name: 'B1', quantity: 1, total: 10 }
    ]);
    const previous = dataset([
      { productId: 'a1', name: 'A1', quantity: 2, total: 50 },
      { productId: 'b1', name: 'B1', quantity: 1, total: 40 }
    ]);
    const result = buildAssortmentAnalysis({ catalog: catalog(products, categories), currentDataset: current, previousDataset: previous });
    const categoryA = result.categoryPerformance.find((row) => row.name === 'Categoría A');
    const categoryB = result.categoryPerformance.find((row) => row.name === 'Categoría B');

    expect(categoryA).toMatchObject({ netSales: 100, previousNetSales: 50, salesDelta: 50, salesDeltaPercent: 1, activeProducts: 3, soldProducts: 2, unsoldProducts: 1 });
    expect(categoryA.signals).toContain('category_growing');
    expect(categoryA.signals).toContain('strong_category_few_products');
    expect(categoryB).toMatchObject({ netSales: 10, previousNetSales: 40, salesDelta: -30, salesDeltaPercent: -0.75 });
    expect(categoryB.signals).toContain('category_declining');
    expect(result.health.concentration).toMatchObject({ topProductShare: 80 / 110, top3ProductShare: 1, topCategoryShare: 100 / 110 });
    expect(result.categoryOpportunities.map((row) => row.name)).toContain('Categoría A');
    expect(result.opportunityCandidates.every((candidate) => candidate.focus.key.startsWith('category_candidate_') || candidate.focus.key.startsWith('product_candidate_'))).toBe(true);
  });

  it('uses a unique exact normalized-name fallback but does not trust a line-row id as productId', () => {
    const products = [{ id: 'p1', name: 'Café', categoryId: 'c1' }];
    const categories = [{ id: 'c1', name: 'Bebidas' }];
    const current = dataset([
      { name: ' cafe ', quantity: 2, total: 10, id: 'unrelated-detail-row-id' }
    ]);
    const result = buildAssortmentAnalysis({ catalog: catalog(products, categories), currentDataset: current });

    expect(result.health.productSalesJoinCoverage).toBe(1);
    expect(result.health.soldProducts).toBe(1);
    expect(result.limitations.some((item) => /relacionaron por nombre exacto normalizado/i.test(item))).toBe(true);
  });

  it('treats a zero-sales previous category as new activity without inventing a percentage change', () => {
    const result = buildAssortmentAnalysis({
      catalog: catalog([{ id: 'p1', name: 'Producto nuevo al catálogo', categoryId: 'c1' }], [{ id: 'c1', name: 'Categoría' }]),
      currentDataset: dataset([{ productId: 'p1', name: 'Producto nuevo al catálogo', quantity: 2, total: 10 }]),
      previousDataset: dataset([])
    });

    expect(result.categoryPerformance[0]).toMatchObject({
      netSales: 10,
      previousNetSales: 0,
      salesDelta: 10,
      salesDeltaPercent: null
    });
    expect(result.categoryPerformance[0].signals).toEqual(expect.arrayContaining([
      'new_category_activity',
      'strong_category_few_products'
    ]));
  });

  it('fails closed for incomplete catalogue/sales and reports no reactivation without a valid previous period', () => {
    const products = [{ id: 'p1', name: 'Existente', categoryId: 'c1' }];
    const categories = [{ id: 'c1', name: 'Categoría' }];
    const partial = buildAssortmentAnalysis({
      catalog: catalog(products, categories, { complete: false, productsTruncated: true }),
      currentDataset: dataset([], { ...completeMetadata, paginationComplete: false }),
      previousDataset: dataset([{ productId: 'p1', name: 'Existente', quantity: 1, total: 15 }])
    });
    const noComparison = buildAssortmentAnalysis({
      catalog: catalog(products, categories),
      currentDataset: dataset([]),
      previousDataset: null
    });
    const empty = buildAssortmentAnalysis({
      catalog: catalog([], []),
      currentDataset: dataset([])
    });

    expect(partial).toMatchObject({ narrativeEligible: false, comparisonAvailable: false, reactivationCandidates: [] });
    expect(partial.health.soldProducts).toBeNull();
    expect(partial.health.unsoldProducts).toBeNull();
    expect(partial.limitations.join(' ')).toMatch(/no se pudo confirmar la lectura completa del catálogo/i);
    expect(partial.limitations.join(' ')).toMatch(/detalle o la paginación.*incompleto/i);
    expect(noComparison).toMatchObject({ comparisonAvailable: false, reactivationCandidates: [], narrativeEligible: false });
    expect(noComparison.limitations.join(' ')).toMatch(/No hay una comparación anterior completa/i);
    expect(empty.health).toMatchObject({ activeCatalogProducts: 0, activeCategories: 0, soldProducts: 0, unsoldProducts: 0 });
    expect(empty.opportunityCandidates).toEqual([]);
    expect(empty.narrativeEligible).toBe(false);
  });
});
