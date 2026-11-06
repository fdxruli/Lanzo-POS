import { getLineRevenue, isMissingUnitCost, normalizeFinancialNumber } from '../sales/financialPolicy';

const isCancelledSale = (sale = {}) => {
  const status = String(sale.status || '').toLowerCase();
  const fulfillmentStatus = String(sale.fulfillmentStatus || '').toLowerCase();
  return status === 'cancelled' || fulfillmentStatus === 'cancelled';
};

// Shared by the dashboard and Lanzó Bot; monetary rules remain in financialPolicy.
export const accumulateProductStats = (sales, productMap) => {

    sales.forEach(sale => {
      if (isCancelledSale(sale) || !Array.isArray(sale.items)) return;

      sale.items.forEach(item => {
        const id = item.parentId || item.id;
        const quantity = normalizeFinancialNumber(item.quantity || 0);
        const lineRevenue = Number(getLineRevenue(item).round(2).toString());
        const rawCost = item.cost;
        const hasMissingCost = isMissingUnitCost(rawCost);
        const unitCost = normalizeFinancialNumber(rawCost);
        const existing = productMap.get(id) || {
          id,
          name: item.name,
          quantity: 0,
          revenue: 0,
          confirmedRevenue: 0,
          confirmedProfit: 0,
          missingRevenue: 0,
          image: item.image
        };

        existing.quantity += quantity;
        existing.revenue += lineRevenue;

        if (hasMissingCost) {
          existing.missingRevenue += lineRevenue;
        } else {
          existing.confirmedRevenue += lineRevenue;
          existing.confirmedProfit += lineRevenue - (unitCost * quantity);
        }

        productMap.set(id, existing);
      });
    });

};

export const aggregateProductStats = (sales = []) => {
    const productMap = new Map();
    accumulateProductStats(sales, productMap);
    return Array.from(productMap.values()).map(product => ({
      ...product,
      marginPct: product.confirmedRevenue > 0
        ? (product.confirmedProfit / product.confirmedRevenue) * 100
        : null
    }));
};
