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

    expect(validation.ok).toBe(true);
    expect(context.sales.products[0]).toMatchObject({
      costStatus: 'definitive',
      costSource: 'inventory_movement'
    });
    expect(JSON.stringify(context)).not.toContain('product-secret');
  });
});
