import { describe, expect, it } from 'vitest';
import {
  WHAT_IF_CHANGE_LIMITS,
  buildCommercialStrategyCandidates,
  buildGoalSimulation,
  buildWhatIfAnalysis,
  summarizeGoalSimulation
} from '../commercialScenarioAnalytics';

const current = {
  netSales: 76000,
  salesCount: 76,
  averageTicket: 1000,
  costOfSale: 45600,
  profit: 30400,
  margin: 0.4,
  costComplete: true,
  products: [{
    name: 'Producto A', quantity: 1.25, netSales: 125, averagePrice: 100,
    cost: 75, unitCost: 60, profit: 50, margin: 0.4, costKnown: true
  }, {
    name: 'Sin costo', quantity: 2.5, netSales: 250, averagePrice: 100,
    cost: null, unitCost: null, profit: null, margin: null, costKnown: false
  }]
};

describe('commercial goal and what-if simulations', () => {
  it('calculates the sales goal gap, progress, ticket count and required average ticket', () => {
    const goal = buildGoalSimulation({
      current,
      coverage: { complete: true },
      scenario: { goalType: 'revenue', targetValue: 100000 }
    });

    expect(goal).toMatchObject({
      ready: true, state: 'remaining', targetValue: 100000, currentValue: 76000,
      revenueGap: 24000, gap: 24000, gapPercent: 24, progress: 0.76,
      currentTickets: 76, currentAverageTicket: 1000,
      requiredAdditionalTicketsAtCurrentTicket: 24,
      requiredAverageTicketAtCurrentTicketCount: 1315.79
    });
  });

  it('reports an achieved goal and excess without a negative gap', () => {
    const goal = buildGoalSimulation({
      current: { ...current, netSales: 70000 },
      coverage: { complete: true },
      scenario: { goalType: 'revenue', targetValue: 50000 }
    });
    expect(goal).toMatchObject({ state: 'achieved', gap: 0, revenueGap: 0, excess: 20000, progress: 1.4 });
  });

  it('keeps zero-sales ticket requirements unavailable instead of dividing by zero', () => {
    const goal = buildGoalSimulation({
      current: { netSales: 0, salesCount: 0, averageTicket: null, costComplete: false, products: [] },
      coverage: { complete: true },
      scenario: { goalType: 'revenue', targetValue: 100000 }
    });
    expect(goal).toMatchObject({ state: 'remaining', progress: 0, revenueGap: 100000 });
    expect(goal.requiredAdditionalTicketsAtCurrentTicket).toBeNull();
    expect(goal.requiredAverageTicketAtCurrentTicketCount).toBeNull();
  });

  it.each([
    { margin: 0, message: /margen actual es cero o negativo/i },
    { margin: -0.1, message: /margen actual es cero o negativo/i }
  ])('does not calculate required revenue for a non-positive profit margin', ({ margin, message }) => {
    const goal = buildGoalSimulation({
      current: { ...current, margin, profit: margin * current.netSales },
      coverage: { complete: true },
      scenario: { goalType: 'gross_profit', targetValue: 20000 }
    });
    expect(goal.ready).toBe(false);
    expect(goal.requiredRevenue).toBeUndefined();
    expect(goal.limitation).toMatch(message);
  });

  it('does not infer a profit goal from partial cost coverage', () => {
    const goal = buildGoalSimulation({
      current: { ...current, costComplete: false, costOfSale: null, profit: null, margin: null },
      coverage: { complete: false },
      scenario: { goalType: 'gross_profit', targetValue: 20000 }
    });
    expect(goal).toMatchObject({ ready: false, state: 'unavailable', currentValue: null, gap: null });
    expect(goal.limitation).toMatch(/faltan costos/i);
  });

  it('calculates a profit target only with complete positive margin and keeps achieved targets safe', () => {
    const goal = buildGoalSimulation({
      current,
      coverage: { complete: true },
      scenario: { goalType: 'gross_profit', targetValue: 20000 }
    });
    expect(goal).toMatchObject({
      ready: true, state: 'achieved', currentProfit: 30400, targetProfit: 20000,
      profitGap: 0, excess: 10400, requiredRevenue: 50000,
      additionalRevenue: 0, equivalentAdditionalTickets: 0, currentMargin: 0.4
    });
    expect(goal.assumptions.join(' ')).toMatch(/mezcla.*margen.*constantes/i);
  });

  it('calculates an average-ticket target as a mathematical scenario at the current ticket count', () => {
    const goal = buildGoalSimulation({
      current,
      coverage: { complete: true },
      scenario: { goalType: 'average_ticket', targetValue: 1250 }
    });
    expect(goal).toMatchObject({
      ready: true, currentAverageTicket: 1000, ticketDifference: 250,
      ticketChangePercent: 25, currentTickets: 76,
      requiredSalesAtCurrentTicketCount: 95000,
      salesIncreaseAtCurrentTicketCount: 19000
    });
    expect(goal.assumptions.join(' ')).toMatch(/matemática.*número actual/i);
  });

  it('calculates a gross-margin gap without inventing a price, cost or product-mix recipe', () => {
    const goal = buildGoalSimulation({
      current,
      coverage: { complete: true },
      scenario: { goalType: 'gross_margin', targetValue: 30 }
    });
    expect(goal).toMatchObject({
      ready: true, currentMargin: 0.4, targetMargin: 0.3,
      currentProfit: 30400, requiredProfitAtCurrentSales: 22800,
      additionalProfitRequired: -7600
    });
    expect(goal).not.toHaveProperty('requiredPrice');
    expect(goal.state).toBe('achieved');
    expect(summarizeGoalSimulation(goal).executiveSummary).toMatch(/ya se alcanzó/i);
    expect(summarizeGoalSimulation(goal).explanation).toMatch(/supera/i);
  });

  it('calculates a product price for a target margin, but rejects missing or explicitly zero cost', () => {
    const productGoal = buildGoalSimulation({
      current, coverage: { complete: true },
      scenario: { goalType: 'product_margin', productName: 'Producto A', targetValue: 30 }
    });
    expect(productGoal).toMatchObject({
      ready: true, currentPrice: 100, unitCost: 60, currentMargin: 0.4,
      targetValue: 30, requiredPrice: 85.71, priceDifference: -14.29
    });
    expect(productGoal.assumptions.join(' ')).toMatch(/no cambia el precio real/i);

    const missingCostGoal = buildGoalSimulation({
      current, coverage: { complete: true },
      scenario: { goalType: 'product_margin', productName: 'Sin costo', targetValue: 30 }
    });
    expect(missingCostGoal.ready).toBe(false);
    expect(missingCostGoal.unitCost).toBeNull();
    expect(missingCostGoal.requiredPrice).toBeNull();

    const zeroCostGoal = buildGoalSimulation({
      current: { ...current, products: [{
        name: 'Gratis', averagePrice: 100, unitCost: 0, costKnown: true, margin: 1
      }] },
      coverage: { complete: true },
      scenario: { goalType: 'product_margin', productName: 'Gratis', targetValue: 30 }
    });
    expect(zeroCostGoal.ready).toBe(false);
    expect(zeroCostGoal.limitation).toMatch(/costo unitario conocido de \$0/i);
  });

  it.each([10, -10, 100])('scales sales and complete cost structure by %s%%', (changePercent) => {
    const simulation = buildWhatIfAnalysis({
      current,
      coverage: { complete: true },
      scenario: { changeType: 'sales', changePercent }
    });
    const factor = 1 + changePercent / 100;
    expect(simulation).toMatchObject({ ready: true, changeType: 'sales', changePercent, currentSales: 76000, currentCost: 45600, currentMargin: 0.4, simulatedMargin: 0.4 });
    expect(simulation.simulatedSales).toBeCloseTo(76000 * factor, 2);
    expect(simulation.simulatedCost).toBeCloseTo(45600 * factor, 2);
    expect(simulation.simulatedProfit).toBeCloseTo(30400 * factor, 2);
  });

  it('allows a near-total decline and leaves profit unknown when sales costs are incomplete', () => {
    expect(WHAT_IF_CHANGE_LIMITS).toEqual({ minimum: -99.9, maximum: 500 });
    const simulation = buildWhatIfAnalysis({
      current: { ...current, costComplete: false, costOfSale: null, profit: null, margin: null },
      coverage: { complete: false },
      scenario: { changeType: 'sales', changePercent: -99.9 }
    });
    expect(simulation).toMatchObject({ ready: true, simulatedSales: 76, simulatedCost: null, simulatedProfit: null, simulatedMargin: null });
    expect(simulation.limitations.join(' ')).toMatch(/no predice.*demanda/i);
  });

  it('keeps a zero-sales what-if finite and does not divide by zero', () => {
    const simulation = buildWhatIfAnalysis({
      current: { netSales: 0, salesCount: 0, averageTicket: null, costOfSale: 0, profit: 0, margin: null, costComplete: true },
      coverage: { complete: true },
      scenario: { changeType: 'sales', changePercent: 10 }
    });
    expect(simulation).toMatchObject({
      ready: true, currentSales: 0, simulatedSales: 0, salesDelta: 0,
      currentCost: 0, simulatedCost: 0, currentProfit: 0, simulatedProfit: 0,
      currentMargin: null, simulatedMargin: null
    });
  });

  it('holds ticket count constant and calculates utility only with complete costs', () => {
    const simulation = buildWhatIfAnalysis({
      current,
      coverage: { complete: true },
      scenario: { changeType: 'ticket', changePercent: 15 }
    });
    expect(simulation).toMatchObject({
      ready: true, ticketCount: 76, currentTicket: 1000, simulatedTicket: 1150,
      currentSales: 76000, simulatedSales: 87400, salesDelta: 11400,
      currentProfit: 30400, simulatedProfit: 34960, currentMargin: 0.4, simulatedMargin: 0.4
    });
    expect(simulation.assumptions.join(' ')).toMatch(/mismo número de tickets/i);
  });

  it('preserves fractional product units and does not turn a missing product cost into zero', () => {
    const knownCostSimulation = buildWhatIfAnalysis({
      current,
      coverage: { complete: true },
      scenario: { changeType: 'product', productName: 'Producto A', changePercent: 20 }
    });
    expect(knownCostSimulation).toMatchObject({
      ready: true, historicalUnits: 1.25, simulatedUnits: 1.5,
      averagePrice: 100, historicalSales: 125, simulatedSales: 150,
      currentCost: 75, simulatedCost: 90, currentProfit: 50, simulatedProfit: 60, simulatedMargin: 0.4
    });

    const unknownCostSimulation = buildWhatIfAnalysis({
      current,
      coverage: { complete: false },
      scenario: { changeType: 'product', productName: 'Sin costo', changePercent: 20 }
    });
    expect(unknownCostSimulation).toMatchObject({
      ready: true, historicalUnits: 2.5, simulatedUnits: 3,
      historicalSales: 250, simulatedSales: 300,
      currentCost: null, simulatedCost: null, currentProfit: null, simulatedProfit: null,
      currentMargin: null, simulatedMargin: null
    });
    expect(unknownCostSimulation.limitations.join(' ')).toMatch(/costo.*desconocido/i);
  });

  it('reports unavailable product scenarios for products without history', () => {
    const simulation = buildWhatIfAnalysis({
      current,
      coverage: { complete: true },
      scenario: { changeType: 'product', productName: 'Inexistente', changePercent: 20 }
    });
    expect(simulation).toMatchObject({ ready: false, productName: 'Inexistente' });
  });
});

describe('commercial strategy candidates', () => {
  it('derives grounded distinct priorities from trend, ticket, product risk, assortment and combo evidence', () => {
    const candidates = buildCommercialStrategyCandidates({
      current: { netSales: 900, salesCount: 10, averageTicket: 90, costComplete: true, margin: 0.3 },
      comparison: {
        previousNetSales: 1000, deltaNetSales: -100, deltaNetSalesPercent: -0.1,
        previousSalesCount: 10, deltaSalesCount: 0, previousTicket: 100, deltaTicket: -10,
        deltaMargin: -0.06
      },
      growthSignals: { productsGrowing: [{ name: 'Producto Creciente', currentSales: 300, salesDelta: 50 }] },
      productRisks: [
        { product: 'Producto Riesgoso', riskType: 'low_margin', netSales: 500, margin: 0.1 },
        { product: 'Costo pendiente', riskType: 'missing_cost', netSales: 200 }
      ],
      assortment: {
        health: { concentration: { topCategoryShare: 0.8 }, unsoldProducts: 2, currentSalesCoverageComplete: true },
        categoryPerformance: [{ name: 'Bebidas', topProductShare: 0.7 }],
        categoryOpportunities: [{ name: 'Panadería', signals: ['category_growing'], salesDelta: 40, netSales: 200, salesShare: 0.2 }]
      },
      comboOpportunities: [{ products: ['Producto A', 'Producto B'], tickets: 4, frequency: 0.4, evidenceLevel: 'high' }],
      coverage: {
        comparisonItemsAvailable: true, comparisonDataAvailable: true, comparisonAvailable: true,
        itemsComplete: true, paginationComplete: true, sourceComplete: true,
        assortmentComparisonAvailable: true, complete: true
      }
    });

    expect(candidates.map((item) => item.reasonCode)).toEqual(expect.arrayContaining([
      'ticket_down_sales_stable', 'sales_declining', 'margin_deteriorating',
      'product_cost_missing', 'product_growing', 'category_concentrated', 'category_growing',
      'historical_combo'
    ]));
    expect(candidates[0].priority).toBe('high');
    expect(candidates.every((item) => item.evidenceKeys.length > 0 && item.signal.includes(item.reasonCode))).toBe(true);

    const otherProductSignals = buildCommercialStrategyCandidates({
      current: { costComplete: true },
      productRisks: [{ product: 'Producto Riesgoso', riskType: 'low_margin', netSales: 500, margin: 0.1 }],
      assortment: { health: { unsoldProducts: 2, currentSalesCoverageComplete: true } },
      coverage: { complete: true, itemsComplete: true, paginationComplete: true, sourceComplete: true }
    });
    expect(otherProductSignals.map((item) => item.reasonCode)).toEqual(['product_low_margin', 'products_without_sales']);
  });

  it('gates comparison and cost signals on complete source evidence and returns stable priority ordering', () => {
    const input = {
      current: { netSales: 900, salesCount: 10, averageTicket: 90, costComplete: false, margin: null },
      comparison: { previousNetSales: 1000, deltaNetSales: -100, deltaNetSalesPercent: -0.1, previousSalesCount: 10, deltaSalesCount: 0, previousTicket: 100, deltaTicket: -10, deltaMargin: -0.06 },
      productRisks: [{ product: 'Sin costo', riskType: 'missing_cost', netSales: 200 }],
      coverage: { comparisonItemsAvailable: false, comparisonDataAvailable: false, comparisonAvailable: false, itemsComplete: false, paginationComplete: true, sourceComplete: true }
    };
    const first = buildCommercialStrategyCandidates(input);
    const second = buildCommercialStrategyCandidates(input);
    expect(first).toEqual(second);
    expect(first).toEqual([]);
  });
});
