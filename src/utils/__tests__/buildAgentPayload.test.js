import { describe, expect, it } from 'vitest';
import {
  buildCustomerPayload,
  buildFinancialPayload,
  buildInventoryPayload,
  createFactCollection
} from '../buildAgentPayload';

const start = new Date('2026-08-01T00:00:00.000Z');
const end = new Date('2026-09-01T00:00:00.000Z');
const inRange = '2026-08-15T12:00:00.000Z';

describe('buildAgentPayload deterministic coverage', () => {
  it('reports total, included and omitted without changing source items', () => {
    const items = Array.from({ length: 7 }, (_, index) => ({ id: `item-${index}` }));
    const collection = createFactCollection(items, 3, 'impact_desc', 'provider_payload_limit');

    expect(collection).toMatchObject({ total: 7, included: 3, omitted: 4, sort: 'impact_desc', reason: 'provider_payload_limit' });
    expect(collection.items).toHaveLength(3);
    expect(items).toHaveLength(7);
  });

  it('keeps complete inventory details locally while bounding provider lists', async () => {
    const menu = [
      ...Array.from({ length: 12 }, (_, index) => ({ id: `out-${index}`, name: `Agotado ${index}`, trackStock: true, stock: 0, cost: 10 })),
      ...Array.from({ length: 6 }, (_, index) => ({ id: `dead-${index}`, name: `Muerto ${index}`, trackStock: true, stock: 4, cost: 25 }))
    ];
    const wasteLogs = Array.from({ length: 7 }, (_, index) => ({
      timestamp: inRange,
      category: `cat-${index}`,
      productName: `product-${index}`,
      lossAmount: index + 1
    }));

    const payload = await buildInventoryPayload(start, end, menu, wasteLogs, []);

    expect(payload.inventoryAlerts.outOfStockProducts).toMatchObject({ total: 12, included: 10, omitted: 2 });
    expect(payload.inventoryAlerts.potentialDeadStock).toMatchObject({ total: 6, included: 5, omitted: 1 });
    expect(payload.wasteStats.topWasteCategories).toMatchObject({ total: 7, included: 5, omitted: 2 });
    expect(payload.coverage.complete).toBe(false);
    expect(payload.coverage.factsOmitted).toBeGreaterThan(0);
    expect(payload.localDetails.inventoryAlerts.outOfStockProducts).toHaveLength(12);
    expect(payload.localDetails.inventoryAlerts.potentialDeadStock).toHaveLength(6);
    expect(payload.localDetails.wasteStats.topWasteCategories).toHaveLength(7);
  });

  it('keeps all financial facts locally and exposes truncation only in collections', async () => {
    const sales = Array.from({ length: 12 }, (_, index) => ({
      id: `sale-${index}`,
      timestamp: inRange,
      status: 'completed',
      total: 100 + index,
      paymentMethod: 'cash',
      items: [{ id: `product-${index}`, name: `Producto ${index}`, price: 100 + index, quantity: 1 }]
    }));

    const payload = await buildFinancialPayload(start, end, sales);

    expect(payload.topProducts).toMatchObject({ total: 12, included: 10, omitted: 2 });
    expect(payload.localDetails.topProducts).toHaveLength(12);
    expect(payload.coverage.factsOmitted).toBe(2);
    expect(payload.salesStats.totalRevenue).toBeGreaterThan(0);
  });

  it('anonimiza clientes para el proveedor y conserva nombres sólo en localDetails', async () => {
    const customers = Array.from({ length: 12 }, (_, index) => ({
      id: `customer-${index}`,
      name: `Cliente privado ${index}`,
      debt: index < 7 ? 100 - index : 0,
      createdAt: inRange
    }));
    const sales = customers.map((customer, index) => ({
      id: `sale-${index}`,
      timestamp: inRange,
      customerId: customer.id,
      total: 50 + index,
      items: [{ id: `product-${index}`, categoryName: `category-${index}`, price: 50 + index, quantity: 1 }]
    }));

    const payload = await buildCustomerPayload(start, end, customers, sales);

    expect(payload.debtAnalysis.topDebtors).toMatchObject({ total: 7, included: 5, omitted: 2 });
    expect(payload.loyaltyInsights.topSpenders).toMatchObject({ total: 12, included: 10, omitted: 2 });
    expect(payload.loyaltyInsights.topCategoriesBoughtByRegistered).toMatchObject({ total: 12, included: 5, omitted: 7 });
    expect(payload.debtAnalysis.topDebtors.items[0]).not.toHaveProperty('name');
    expect(payload.loyaltyInsights.topSpenders.items[0]).not.toHaveProperty('name');
    expect(payload.localDetails.debtAnalysis.topDebtors[0].name).toContain('Cliente privado');
    expect(payload.coverage.complete).toBe(false);
  });
});
