import { describe, expect, it } from 'vitest';
import { buildEcommerceContext, buildSalesProfitabilityContext } from '../commercialAgentContext';
import { validatePayload } from '../../../../supabase/functions/lanzo-ai-agent/contract.ts';

describe('commercial AI context boundary', () => {
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
});
