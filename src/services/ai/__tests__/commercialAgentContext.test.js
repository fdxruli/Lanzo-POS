import { describe, expect, it } from 'vitest';
import {
  buildCommercialOpportunityCandidates,
  buildEcommerceContext,
  buildSalesProfitabilityContext
} from '../commercialAgentContext';
import { validatePayload } from '../../../../supabase/functions/lanzo-ai-agent/contract.ts';

describe('commercial AI context boundary', () => {
  it('sends assortment names and aggregates only, excluding internal ids, stock, costs and barcodes', () => {
    const context = buildSalesProfitabilityContext({
      intent: 'assortment_analysis',
      period: { from: '2026-09-01', to: '2026-09-07', previousFrom: '2026-08-25', previousTo: '2026-08-31' },
      source: 'mixed',
      report: {
        overview: { netSales: 100, units: 2, salesCount: 1, unitCosts: 10, profit: 90 },
        assortment: {
          catalog: { source: 'local_tenant_catalog', complete: true, productsRead: 2, categoriesRead: 1, productsTruncated: false, categoriesTruncated: false, tenantId: 'private-tenant-id' },
          health: {
            activeCatalogProducts: 2, inactiveCatalogProducts: 0, soldProducts: 1, unsoldProducts: 1,
            activeCategories: 1, soldCategories: 1, currentSalesCoverageComplete: true, previousComparisonAvailable: true,
            productSalesJoinCoverage: 1, categorySalesCoverage: 1,
            concentration: { topProductShare: 1, top3ProductShare: 1, topCategoryShare: 1, categoryRevenueCoverage: 1 }
          },
          categoryPerformance: [{ name: 'Bebidas', active: true, netSales: 100, salesShare: 1, activeProducts: 2, soldProducts: 1, unsoldProducts: 1, stock: 99 }],
          categoryOpportunities: [{ candidateRef: 'category_candidate_1', name: 'Bebidas', active: true, netSales: 100, salesDelta: 20, salesShare: 1, activeProducts: 2, soldProducts: 1, unsoldProducts: 1, signals: ['category_growing'] }],
          dormantProducts: [{ candidateRef: null, name: 'Sin venta', category: 'Bebidas', activity: 'never_sold_in_window', currentSales: 0, currentUnits: 0, availability: 'availability_unknown', id: 'private-product-id', stock: 99, cost: 12, barcode: 'private-barcode' }],
          reactivationCandidates: [{ candidateRef: 'product_candidate_1', name: 'Reactivar', category: 'Bebidas', activity: 'previously_sold_now_inactive', currentSales: 0, previousSales: 50, currentUnits: 0, previousUnits: 1, availability: 'availability_unknown', reason: 'Ventas anteriores verificadas.' }],
          opportunityCandidates: [{
            key: 'category_candidate_1', type: 'category', focus: { type: 'category', key: 'category_candidate_1' }, entity: 'Bebidas',
            signal: ['category_growing'], recommendationType: 'growth_experiment', strength: 'strong',
            metrics: { currentSales: 100, salesShare: 1, activeProducts: 2, soldProducts: 1, unsoldProducts: 1 },
            evidenceKeys: ['assortment.category:category_candidate_1']
          }],
          evidenceKeys: ['assortment.metric:activeCatalogProducts', 'assortment.metric:soldProducts', 'assortment.metric:unsoldProducts', 'assortment.metric:topProductShare', 'assortment.metric:top3ProductShare', 'assortment.metric:topCategoryShare', 'assortment.category:category_candidate_1'],
          minimumUsefulRecommendations: 1,
          currentPeriod: { netSales: 100, units: 2, complete: true },
          previousPeriod: { netSales: 80, units: 1, complete: true },
          comparisonAvailable: true,
          narrativeEligible: true,
          limitations: ['No se confirmó disponibilidad histórica.']
        },
        coverage: { validSales: 1, itemsComplete: true, paginationComplete: true, sourceComplete: true, complete: true },
        calculations: [], assumptions: [], scenarios: [], limitations: []
      }
    });
    const serialized = JSON.stringify(context);

    expect(context.sales.assortment).toMatchObject({
      catalog: { source: 'local_tenant_catalog', complete: true },
      health: { activeCatalogProducts: 2, unsoldProducts: 1 },
      reactivationCandidates: [expect.objectContaining({ name: 'Reactivar', availability: 'availability_unknown' })]
    });
    expect(context.sales.opportunityCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'category', focus: { type: 'category', key: 'category_candidate_1' }, entity: 'Bebidas' })
    ]));
    expect(serialized).not.toMatch(/private-tenant-id|private-product-id|private-barcode/);
    expect(serialized).not.toMatch(/"(?:stock|cost|unitCost|unit_cost|barcode|profit|margin)"/u);
  });

  it('keeps sales context aggregated and excludes PII/internal identifiers', () => {
    const context = buildSalesProfitabilityContext({
      period: { dateFrom: '2026-09-01', dateTo: '2026-09-21' },
      source: 'cloud',
      report: {
        overview: {
          net_sales: 1200,
          gross_profit: 420,
          customer_name: 'No debe viajar',
          license_id: 'internal-license-id'
        },
        byProduct: [{
          id: 'internal-product-id',
          name: 'Producto A',
          sales: 700,
          phone: '555-0100',
          customer_full_name: 'Persona innecesaria'
        }]
      }
    });

    expect(context).toMatchObject({
      agentKey: 'salesProfitability',
      scope: 'current_authenticated_tenant',
      source: 'cloud',
      sales: { netSales: 1200, profit: 420 }
    });
    expect(context.sales.products).toEqual([
      expect.objectContaining({ name: 'Producto A', netSales: 700 })
    ]);
    expect(JSON.stringify(context)).not.toContain('internal-product-id');
    expect(JSON.stringify(context)).not.toContain('555-0100');
    expect(JSON.stringify(context)).not.toContain('Persona innecesaria');
    expect(JSON.stringify(context)).not.toContain('internal-license-id');
  });

  it('keeps ecommerce context limited to aggregate funnel and catalog fields', () => {
    const context = buildEcommerceContext({
      report: {
        orders: { received: 10, accepted: 8, rejected: 2, converted: 6 },
        events: { total: 30, conversion_rate: 0.2 },
        catalog: {
          published_products: 14,
          eligible_products: 11,
          stock_available: 9,
          best_performers: [{ id: 'secret-id', name: 'Producto B', units: 4 }]
        },
        orders_detail: [{ order_id: 'order-secret', phone: '555-0199' }]
      }
    });

    expect(context.ecommerce.orders).toMatchObject({ received: 10, accepted: 8, rejected: 2, converted: 6 });
    expect(context.ecommerce.catalog).toMatchObject({ published: 14, eligible: 11, availableStock: 9 });
    expect(JSON.stringify(context)).not.toContain('order-secret');
    expect(JSON.stringify(context)).not.toContain('555-0199');
    expect(JSON.stringify(context)).not.toContain('secret-id');
  });

  it('preserves missing-cost nulls in the context accepted by the deployed Edge contract', () => {
    const context = buildSalesProfitabilityContext({
      period: { dateFrom: '2026-09-01', dateTo: '2026-09-07', label: 'Periodo actual' },
      source: 'cloud',
      report: {
        overview: {
          netSales: 100,
          unitCosts: null,
          knownCostOfSale: 20,
          profit: null,
          margin: null,
          costCoverage: 0.5,
          missingCostProducts: 1,
          profitabilityStatus: 'undetermined',
          profitabilityExplanation: 'Falta evidencia de costo.'
        },
        products: [{
          name: 'Producto sintético',
          quantity: 2,
          netSales: 100,
          unitCost: null,
          profit: null,
          margin: null,
          averagePrice: 50,
          costKnown: false,
          costStatus: 'incomplete',
          costSource: 'missing'
        }],
        coverage: {
          validSales: 1,
          productsIncluded: 1,
          productsMissingCost: 1,
          costCoverage: 0.5,
          knownCostOfSale: 20,
          costStatus: 'incomplete',
          complete: false,
          itemsComplete: true,
          paginationComplete: true,
          sourceComplete: true
        },
        calculations: [],
        assumptions: [],
        limitations: ['Falta evidencia de costo.'],
        scenarios: []
      }
    });

    const validation = validatePayload({
      auth: {
        licenseKey: 'synthetic-license',
        deviceFingerprint: 'synthetic-device',
        deviceSecurityToken: 'synthetic-device-token',
        staffSessionToken: null
      },
      agentKey: 'salesProfitability',
      intent: 'product_risk',
      question: '¿Qué productos requieren revisar su costo?',
      requestKey: 'missing-cost-context-test',
      period: { from: '2026-09-01', to: '2026-09-07', timezone: 'America/Mexico_City' },
      scenario: {},
      context,
      options: { temperature: 0.2, maxTokens: 2048 }
    });

    expect(validation.ok, JSON.stringify(validation)).toBe(true);
    expect(context.sales.summary).toMatchObject({
      unitCosts: null,
      profit: null,
      margin: null,
      costCoverage: 0.5,
      missingCostProducts: 1,
      profitabilityStatus: 'undetermined'
    });
    expect(context.sales.products[0]).toMatchObject({
      unitCost: null,
      profit: null,
      margin: null,
      costKnown: false,
      costStatus: 'incomplete',
      costSource: 'missing'
    });
  });

  it('produces a sales context accepted by the Edge contract, including cost provenance', () => {
    const context = buildSalesProfitabilityContext({
      period: {
        dateFrom: '2026-09-01',
        dateTo: '2026-09-21',
        label: 'Periodo actual'
      },
      source: 'cloud',
      report: {
        overview: {
          net_sales: 1200,
          units: 24,
          sales_count: 8,
          average_ticket: 150,
          discounts: 20,
          discountsKnown: true,
          unit_costs: 500,
          knownCostOfSale: 500,
          gross_profit: 680,
          gross_margin: 0.5667
        },
        byProduct: [{
          internal_product_id: 'product-secret',
          name: 'Producto A',
          quantity: 2,
          sales: 100,
          unit_cost: 20,
          profit: 60,
          margin: 0.6,
          average_price: 50,
          costKnown: true,
          costStatus: 'definitive',
          costSource: 'inventory_movement',
          riskType: 'margin',
          riskReason: 'Margen estable'
        }],
        channels: [{ channel: 'Físico', netSales: 1200, orders: 8, averageTicket: 150 }],
        coverage: {
          validSales: 8,
          productsIncluded: 1,
          productsMissingCost: 0,
          costCoverage: 1,
          complete: true,
          itemsComplete: true,
          paginationComplete: true,
          sourceComplete: true
        },
        calculations: [],
        assumptions: [],
        limitations: [],
        scenarios: []
      }
    });

    const validation = validatePayload({
      auth: {
        licenseKey: 'synthetic-license',
        deviceFingerprint: 'synthetic-device',
        deviceSecurityToken: 'synthetic-device-token',
        staffSessionToken: null
      },
      agentKey: 'salesProfitability',
      intent: 'profitability_summary',
      question: '¿Mi negocio es rentable?',
      requestKey: 'context-contract-test',
      period: { from: '2026-09-01', to: '2026-09-21', timezone: 'America/Mexico_City' },
      scenario: {},
      context,
      options: { temperature: 0.2, maxTokens: 2048 }
    });

    expect(validation.ok, JSON.stringify(validation)).toBe(true);
    expect(context.sales.products[0]).toMatchObject({
      costStatus: 'definitive',
      costSource: 'inventory_movement'
    });
    expect(JSON.stringify(context)).not.toContain('product-secret');
  });

  it('preserves typed growth, product and channel evidence accepted by the Edge contract', () => {
    const productChange = {
      name: 'Producto A',
      currentSales: 300,
      previousSales: 200,
      salesDelta: 100,
      salesDeltaPercent: 0.5,
      currentUnits: 6,
      previousUnits: 4,
      unitsDelta: 2,
      currentShare: 0.25,
      previousShare: 0.2,
      salesShareDelta: 0.05,
      currentMargin: null,
      previousMargin: null,
      currentProfit: null,
      previousProfit: null,
      costKnown: false,
      costStatus: 'missing',
      direction: 'growing',
      signals: ['growing', 'cost_unknown']
    };
    const productOpportunity = {
      ...productChange,
      opportunityReason: 'Creció en ventas y unidades.'
    };
    const context = buildSalesProfitabilityContext({
      period: { dateFrom: '2026-09-01', dateTo: '2026-09-07', label: 'Periodo actual' },
      source: 'cloud',
      report: {
        overview: { netSales: 1200, units: 24, salesCount: 8, averageTicket: 150, unitsPerTicket: 3 },
        products: [{ name: 'Producto A', quantity: 6, netSales: 300, salesShare: 0.25, unitCost: null, costKnown: false }],
        channels: [{ channel: 'Físico', netSales: 900, orders: 6, units: 18, averageTicket: 150, share: 0.75 }],
        comparison: {
          previousNetSales: 1000,
          previousUnits: 20,
          previousTicket: 125,
          previousUnitsPerTicket: 2.5,
          deltaNetSales: 200,
          deltaNetSalesPercent: 0.2,
          deltaUnits: 4,
          deltaTicket: 25,
          deltaUnitsPerTicket: 0.5,
          currentSalesCount: 8,
          previousSalesCount: 8,
          deltaSalesCount: 0,
          productChanges: [productChange],
          channelMixChanges: [{ channel: 'Físico', currentShare: 0.75, previousShare: 0.7, deltaShare: 0.05, currentSales: 900, previousSales: 700, salesDelta: 200 }]
        },
        growthSignals: {
          currentNetSales: 1200,
          currentSalesCount: 8,
          currentUnits: 24,
          currentAverageTicket: 150,
          currentUnitsPerTicket: 3,
          previousNetSales: 1000,
          deltaNetSales: 200,
          deltaNetSalesPercent: 0.2,
          productsGrowing: [productChange],
          productOpportunities: [productOpportunity],
          channelChanges: [{ channel: 'Físico', currentShare: 0.75, previousShare: 0.7, deltaShare: 0.05, currentSales: 900, previousSales: 700, salesDelta: 200 }],
          comparisonAvailable: true
        },
        coverage: {
          validSales: 8,
          complete: true,
          itemsComplete: true,
          paginationComplete: true,
          sourceComplete: true,
          comparisonDataAvailable: true,
          comparisonItemsAvailable: true,
          salesDataComplete: true,
          growthDataComplete: true
        }
      }
    });

    const validation = validatePayload({
      auth: {
        licenseKey: 'synthetic-license',
        deviceFingerprint: 'synthetic-device',
        deviceSecurityToken: 'synthetic-device-token',
        staffSessionToken: null
      },
      agentKey: 'salesProfitability',
      intent: 'sales_growth',
      question: '¿Cómo crecieron mis ventas?',
      requestKey: 'growth-context-contract-test',
      period: {
        from: '2026-09-01', to: '2026-09-07', previousFrom: '2026-08-25', previousTo: '2026-08-31', timezone: 'America/Mexico_City'
      },
      scenario: {},
      context,
      options: { temperature: 0.2, maxTokens: 2048 }
    });

    expect(validation.ok, JSON.stringify(validation)).toBe(true);
    expect(context.sales.unitsPerTicket).toBe(3);
    expect(context.sales.comparison.productChanges[0]).toMatchObject({
      direction: 'growing',
      costKnown: false,
      costStatus: 'missing',
      currentMargin: null,
      signals: ['growing', 'cost_unknown']
    });
    expect(context.sales.growthSignals.productOpportunities).toHaveLength(1);
    expect(context.sales.growthSignals.productOpportunities[0].opportunityReason).toBe('Creció en ventas y unidades.');
  });

  it('sends a bounded, intent-specific narrative context for sales growth', () => {
    const products = Array.from({ length: 10 }, (_, index) => ({
      name: `Producto ${index}`,
      currentSales: 1000 - index * 10,
      previousSales: 500,
      salesDelta: index * 25,
      salesDeltaPercent: index / 10,
      currentUnits: 12,
      previousUnits: 8,
      unitsDelta: 4,
      currentShare: 0.2,
      previousShare: 0.1,
      salesShareDelta: 0.1,
      currentMargin: 0.4,
      previousMargin: 0.35,
      currentProfit: 400,
      previousProfit: 175,
      costKnown: index % 2 === 0,
      costStatus: index % 2 === 0 ? 'definitive' : 'missing',
      direction: 'growing',
      signals: ['growing', 'high_sales_share', 'healthy_margin'],
      opportunityReason: 'Señal sintética de crecimiento.'
    }));
    const declining = products.map((product, index) => ({
      ...product,
      name: `Caída ${index}`,
      salesDelta: -(index + 1) * 20,
      direction: 'declining',
      signals: ['declining']
    }));
    const channelChanges = Array.from({ length: 5 }, (_, index) => ({
      channel: `Canal ${index}`,
      currentShare: 0.4,
      previousShare: 0.3,
      deltaShare: 0.1,
      currentSales: 100 + index,
      previousSales: 50,
      salesDelta: index * 30
    }));
    const context = buildSalesProfitabilityContext({
      intent: 'sales_growth',
      period: { from: '2026-09-01', to: '2026-09-07', previousFrom: '2026-08-25', previousTo: '2026-08-31' },
      source: 'cloud',
      report: {
        overview: { netSales: 2400, units: 48, salesCount: 16, averageTicket: 150, unitsPerTicket: 3 },
        products,
        channels: channelChanges,
        comparison: {
          previousNetSales: 2000,
          previousUnits: 40,
          previousTicket: 125,
          previousUnitsPerTicket: 2.5,
          previousSalesCount: 16,
          deltaNetSales: 400,
          deltaNetSalesPercent: 0.2,
          deltaUnits: 8,
          deltaTicket: 25,
          deltaUnitsPerTicket: 0.5,
          deltaSalesCount: 0,
          productChanges: [...products, ...declining],
          channelMixChanges: channelChanges
        },
        growthSignals: {
          currentNetSales: 2400,
          previousNetSales: 2000,
          deltaNetSales: 400,
          productsGrowing: products,
          productsDeclining: declining,
          productOpportunities: products,
          channelChanges,
          comparisonAvailable: true
        },
        coverage: {
          validSales: 16,
          complete: true,
          itemsComplete: true,
          paginationComplete: true,
          sourceComplete: true,
          comparisonDataAvailable: true,
          salesDataComplete: true,
          growthDataComplete: true
        },
        calculations: Array.from({ length: 20 }, (_, index) => ({
          label: `Cálculo ${index}`,
          value: index,
          formattedValue: String(index),
          formula: 'deterministic fixture',
          source: 'fixture',
          period: { from: '2026-09-01', to: '2026-09-07' }
        })),
        assumptions: ['No mandar a la narrativa'],
        scenarios: [{ label: 'No mandar a la narrativa' }],
        limitations: ['No mandar a la narrativa']
      }
    });

    expect(context.sales.summary).toEqual({
      netSales: 2400,
      salesCount: 16,
      units: 48,
      averageTicket: 150,
      unitsPerTicket: 3
    });
    expect(context.sales.products).toEqual([]);
    expect(context.sales.channels).toEqual([]);
    expect(context.sales.comparison).not.toHaveProperty('productChanges');
    expect(context.sales.comparison).not.toHaveProperty('channelMixChanges');
    expect(context.sales.growthSignals).not.toHaveProperty('currentNetSales');
    expect(context.sales.growthSignals.productOpportunities).toHaveLength(3);
    expect(context.sales.growthSignals.productsDeclining).toHaveLength(3);
    expect(context.sales.growthSignals.channelChanges).toHaveLength(2);
    expect(context.sales.growthSignals.productOpportunities[0].name).toBe('Producto 9');
    expect(context.sales.growthSignals.productOpportunities[0]).not.toHaveProperty('currentMargin');
    expect(context.sales.evidenceKeys.length).toBeLessThanOrEqual(24);
    expect(context.sales.evidenceKeys).toContain('product:Producto 9');
    expect(context.sales.evidenceKeys).toContain('channel:Canal 4');
    expect(context.sales.evidenceKeys).toContain('metric:deltaNetSales');
    expect(context.sales.opportunityCandidates.length).toBeGreaterThanOrEqual(2);
    expect(context.sales.minimumUsefulRecommendations).toBe(2);
    expect(context.sales.opportunityCandidates[0]).toMatchObject({
      type: 'product',
      focus: { type: 'product', key: 'Producto 7' },
      recommendationType: 'growth_experiment',
      strength: 'strong',
      evidenceKeys: expect.arrayContaining(['product:Producto 7'])
    });
    expect(context.sales.opportunityCandidates.some((candidate) => candidate.type === 'ticket')).toBe(true);
    expect(context.sales.calculations).toEqual([]);
    expect(context.sales.assumptions).toEqual([]);
    expect(context.sales.scenarios).toEqual([]);
    expect(context.sales.limitations).toEqual([]);
    expect(JSON.stringify(context).length).toBeLessThan(6000);

    const validation = validatePayload({
      auth: {
        licenseKey: 'synthetic-license',
        deviceFingerprint: 'synthetic-device',
        deviceSecurityToken: 'synthetic-device-token',
        staffSessionToken: null
      },
      agentKey: 'salesProfitability',
      intent: 'sales_growth',
      question: '¿Cómo puedo aumentar mis ventas?',
      requestKey: 'compact-growth-context-test',
      period: {
        from: '2026-09-01', to: '2026-09-07', previousFrom: '2026-08-25', previousTo: '2026-08-31'
      },
      scenario: {},
      context,
      options: { temperature: 0.2, maxTokens: 2048 }
    });
    expect(validation.ok, JSON.stringify(validation)).toBe(true);
  });

  it('sets the minimum actionable recommendations from independent strong candidates', () => {
    const plan = buildCommercialOpportunityCandidates('sales_growth', {
      summary: { averageTicket: 100, salesCount: 8 },
      comparison: { deltaTicket: 10, deltaSalesCount: 2 },
      growthSignals: {
        productOpportunities: [{
          name: 'Producto con señal',
          currentSales: 500,
          currentShare: 0.3,
          costKnown: false,
          direction: 'growing',
          signals: ['growing', 'high_sales_share']
        }]
      },
      evidenceKeys: [
        'product:Producto con señal',
        'metric:currentNetSales',
        'metric:currentAverageTicket',
        'metric:deltaTicket',
        'metric:deltaSalesCount'
      ]
    });

    expect(plan.minimumUsefulRecommendations).toBe(2);
    expect(plan.candidates.map((candidate) => candidate.type)).toEqual(expect.arrayContaining(['product', 'ticket', 'tickets']));
    expect(plan.candidates.find((candidate) => candidate.type === 'product').metrics).toMatchObject({ costKnown: false });
    expect(plan.candidates.find((candidate) => candidate.type === 'product').metrics).not.toHaveProperty('margin');

    const limited = buildCommercialOpportunityCandidates('sales_growth', {
      summary: {}, comparison: {}, growthSignals: {}, evidenceKeys: []
    });
    expect(limited.minimumUsefulRecommendations).toBe(0);
    expect(limited.candidates).toEqual([]);
  });

  it('only sends product margin evidence when the cost is known', () => {
    const context = buildSalesProfitabilityContext({
      intent: 'product_opportunity',
      period: { from: '2026-09-01', to: '2026-09-07' },
      source: 'cloud',
      report: {
        overview: { netSales: 1200, salesCount: 8 },
        growthSignals: {
          productOpportunities: [{
            name: 'Con costo',
            currentSales: 300,
            previousSales: 200,
            salesDelta: 100,
            salesDeltaPercent: 0.5,
            currentShare: 0.25,
            previousShare: 0.2,
            salesShareDelta: 0.05,
            currentMargin: 0.4,
            previousMargin: 0.3,
            currentProfit: 120,
            previousProfit: 60,
            costKnown: true,
            costStatus: 'known',
            direction: 'growing',
            signals: ['growing', 'healthy_margin'],
            opportunityReason: 'Costos confirmados.'
          }, {
            name: 'Sin costo',
            currentSales: 250,
            previousSales: 200,
            salesDelta: 50,
            salesDeltaPercent: 0.25,
            currentShare: 0.2,
            previousShare: 0.18,
            salesShareDelta: 0.02,
            currentMargin: 0.99,
            previousMargin: 0.99,
            currentProfit: 247.5,
            previousProfit: 198,
            costKnown: false,
            costStatus: 'missing',
            direction: 'growing',
            signals: ['growing', 'cost_unknown'],
            opportunityReason: 'El costo no está disponible.'
          }],
          comparisonAvailable: true
        },
        coverage: { costCoverage: 0.5, complete: true }
      }
    });
    const opportunities = context.sales.growthSignals.productOpportunities;
    expect(opportunities).toHaveLength(2);
    expect(opportunities[0]).toMatchObject({ currentMargin: 0.4, currentProfit: 120, costKnown: true });
    expect(opportunities[1]).not.toHaveProperty('currentMargin');
    expect(opportunities[1]).not.toHaveProperty('currentProfit');
  });

  it('sends allowlisted goal and what-if snapshots without raw rows or internal identifiers', () => {
    const report = {
      overview: { netSales: 76000, units: 80, salesCount: 76, averageTicket: 1000, profit: 30400, margin: 0.4 },
      coverage: { validSales: 76, complete: true, costCoverage: 1 },
      goalSimulation: {
        type: 'revenue', targetValue: 100000, currentValue: 76000, ready: true, state: 'remaining',
        gap: 24000, gapPercent: 24, excess: 0, progress: 0.76, revenueGap: 24000,
        currentSales: 76000, currentTickets: 76, currentAverageTicket: 1000,
        requiredAdditionalTicketsAtCurrentTicket: 24,
        requiredAverageTicketAtCurrentTicketCount: 1315.79, assumptions: [], limitations: [],
        saleIds: ['internal-sale-id']
      },
      whatIfSimulation: {
        changeType: 'sales', changePercent: -10, ready: true, currentSales: 76000,
        simulatedSales: 68400, salesDelta: -7600, currentCost: null, simulatedCost: null,
        currentProfit: null, simulatedProfit: null, profitDelta: null, currentMargin: null,
        simulatedMargin: null, assumptions: [], limitations: [], customerEmail: 'hidden@example.test'
      },
      rawRows: [{ sale_id: 'internal-sale-id' }]
    };
    const goalContext = buildSalesProfitabilityContext({
      intent: 'goal_simulation', period: { from: '2026-09-01', to: '2026-09-30' }, report
    });
    const whatIfContext = buildSalesProfitabilityContext({
      intent: 'what_if_analysis', period: { from: '2026-09-01', to: '2026-09-30' }, report
    });

    expect(goalContext.sales.goalSimulation).toMatchObject({ type: 'revenue', targetValue: 100000, requiredAdditionalTicketsAtCurrentTicket: 24 });
    expect(whatIfContext.sales.whatIfSimulation).toMatchObject({ changeType: 'sales', changePercent: -10, simulatedSales: 68400 });
    const serialized = JSON.stringify([goalContext, whatIfContext]);
    expect(serialized).not.toContain('saleIds');
    expect(serialized).not.toContain('internal-sale-id');
    expect(serialized).not.toContain('hidden@example.test');
    expect(goalContext.sales).not.toHaveProperty('rawRows');
  });
});
