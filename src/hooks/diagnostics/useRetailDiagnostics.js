/**
 * useRetailDiagnostics
 *
 * Hook especializado para diagnóstico operativo de retail y abarrotes.
 * Enfocado en capital muerto, márgenes bajos y aumentos de costo.
 */

import { useCallback, useEffect, useState } from 'react';
import { db, STORES } from '../../services/db/dexie';
import { isMissingUnitCost, normalizeFinancialNumber } from '../../services/sales/financialPolicy';

const CONFIG = {
  DEAD_STOCK: {
    NO_SALES_DAYS: 45,
    MIN_INVESTMENT: 500,
    ANALYSIS_SALES_DAYS: 60
  },
  MARGIN: {
    CRITICAL_THRESHOLD: 0.15,
    WARNING_THRESHOLD: 0.20
  }
};

const INITIAL_STATE = {
  alerts: [],
  isLoading: true,
  error: null,
  summary: null,
  rawData: null
};

const formatCurrency = (amount) => `$${Number(amount || 0).toFixed(2)}`;

const calculateMargin = (price, cost) => {
  const numericPrice = normalizeFinancialNumber(price || 0);
  const numericCost = normalizeFinancialNumber(cost || 0);

  if (numericPrice <= 0) return 0;
  if (isMissingUnitCost(numericCost)) return null;

  return (numericPrice - numericCost) / numericPrice;
};

const getRecentSales = async (days = 60) => {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffISO = cutoffDate.toISOString();

  const sales = await db.table(STORES.SALES)
    .where('timestamp')
    .aboveOrEqual(cutoffISO)
    .toArray();

  return sales.filter(sale => {
    const isClosed = sale.status === 'closed' || sale.fulfillmentStatus === 'completed' || sale.fulfillmentStatus === 'fulfilled';
    return isClosed && !sale.splitParentId && Array.isArray(sale.items);
  });
};

const getActiveInventory = async () => {
  return await db.table(STORES.MENU)
    .filter(product =>
      product.isActive !== false
      && product.trackStock !== false
      && normalizeFinancialNumber(product.stock || 0) > 0
    )
    .toArray();
};

const getInventoryMovements = async () => {
  try {
    return await db.table(STORES.MOVIMIENTOS_CAJA)
      .filter(movement => movement.tipo === 'salida' && movement.categoria?.includes('compra'))
      .toArray();
  } catch {
    return [];
  }
};

const getProductBatches = async () => {
  try {
    return await db.table(STORES.PRODUCT_BATCHES).toArray();
  } catch {
    return [];
  }
};

const analyzeDeadStock = (sales, inventory) => {
  if (!inventory || inventory.length === 0) return null;

  const soldProductIds = new Set();

  sales.forEach(sale => {
    sale.items?.forEach(item => {
      const productId = item.parentId || item.id;
      if (productId) soldProductIds.add(productId);
    });
  });

  const deadStockProducts = [];
  let totalDeadStockValue = 0;

  inventory.forEach(product => {
    if (soldProductIds.has(product.id)) return;

    const stock = normalizeFinancialNumber(product.stock || 0);
    const cost = normalizeFinancialNumber(product.cost || 0);
    const price = normalizeFinancialNumber(product.price || 0);
    const stockValue = cost * stock;

    if (stockValue >= CONFIG.DEAD_STOCK.MIN_INVESTMENT) {
      deadStockProducts.push({
        productId: product.id,
        name: product.name,
        sku: product.sku,
        category: product.categoryName || product.category,
        currentStock: stock,
        costPerUnit: cost,
        pricePerUnit: price,
        totalInvestment: stockValue,
        potentialRevenue: price * stock,
        lastSaleDate: null
      });
      totalDeadStockValue += stockValue;
    }
  });

  deadStockProducts.sort((a, b) => b.totalInvestment - a.totalInvestment);

  return {
    deadStockProducts,
    totalDeadStockValue,
    productCount: deadStockProducts.length,
    totalPotentialRevenue: deadStockProducts.reduce((sum, product) => sum + product.potentialRevenue, 0)
  };
};

const analyzeMargins = (inventory) => {
  if (!inventory || inventory.length === 0) return null;

  const criticalMargin = [];
  const warningMargin = [];
  const healthyMargin = [];
  const missingCostProducts = [];
  const knownCostMargins = [];

  inventory.forEach(product => {
    const margin = calculateMargin(product.price, product.cost);
    const price = normalizeFinancialNumber(product.price || 0);
    const cost = normalizeFinancialNumber(product.cost || 0);
    const stock = normalizeFinancialNumber(product.stock || 0);

    if (margin === null) {
      missingCostProducts.push({
        productId: product.id,
        name: product.name,
        sku: product.sku,
        category: product.categoryName || product.category,
        cost,
        price,
        stock,
        revenueAtRisk: price * stock
      });
      return;
    }

    const marginPercent = margin * 100;
    const profitPerUnit = price - cost;
    knownCostMargins.push(margin);

    const productData = {
      productId: product.id,
      name: product.name,
      sku: product.sku,
      category: product.categoryName || product.category,
      cost,
      price,
      margin: marginPercent,
      profitPerUnit,
      stock,
      totalProfitPotential: profitPerUnit * stock
    };

    if (margin < CONFIG.MARGIN.CRITICAL_THRESHOLD) {
      criticalMargin.push(productData);
    } else if (margin < CONFIG.MARGIN.WARNING_THRESHOLD) {
      warningMargin.push(productData);
    } else {
      healthyMargin.push(productData);
    }
  });

  return {
    criticalMargin,
    warningMargin,
    healthyMargin,
    criticalImpact: criticalMargin.reduce((sum, product) => sum + product.totalProfitPotential, 0),
    warningImpact: warningMargin.reduce((sum, product) => sum + product.totalProfitPotential, 0),
    criticalCount: criticalMargin.length,
    warningCount: warningMargin.length,
    healthyCount: healthyMargin.length,
    missingCostProducts,
    missingCostCount: missingCostProducts.length,
    missingCostRevenueAtRisk: missingCostProducts.reduce((sum, product) => sum + product.revenueAtRisk, 0),
    avgMargin: knownCostMargins.length > 0
      ? knownCostMargins.reduce((sum, margin) => sum + margin, 0) / knownCostMargins.length * 100
      : 0
  };
};

const analyzeCostIncreases = (inventory, batches) => {
  if (!inventory || inventory.length === 0 || !batches || batches.length === 0) return null;

  const batchesByProduct = new Map();

  batches.forEach(batch => {
    const list = batchesByProduct.get(batch.productId) || [];
    list.push(batch);
    batchesByProduct.set(batch.productId, list);
  });

  const productsWithCostIncrease = [];

  inventory.forEach(product => {
    const productBatches = batchesByProduct.get(product.id) || [];
    if (productBatches.length < 2) return;

    const sortedBatches = [...productBatches].sort((a, b) => {
      return new Date(b.createdAt || b.expiryDate || 0) - new Date(a.createdAt || a.expiryDate || 0);
    });

    const latestBatch = sortedBatches[0];
    const previousBatch = sortedBatches[1];
    const latestCost = normalizeFinancialNumber(latestBatch.cost || 0);
    const previousCost = normalizeFinancialNumber(previousBatch.cost || 0);

    if (previousCost <= 0) return;

    const costIncrease = latestCost - previousCost;
    const costIncreasePercent = (costIncrease / previousCost) * 100;

    if (costIncreasePercent > 10) {
      const currentMargin = calculateMargin(product.price, latestCost);

      if (currentMargin !== null && currentMargin < CONFIG.MARGIN.WARNING_THRESHOLD) {
        productsWithCostIncrease.push({
          productId: product.id,
          name: product.name,
          sku: product.sku,
          previousCost,
          latestCost,
          costIncrease,
          costIncreasePercent,
          currentPrice: normalizeFinancialNumber(product.price || 0),
          currentMargin: currentMargin * 100,
          recommendedPrice: latestCost / (1 - CONFIG.MARGIN.WARNING_THRESHOLD),
          stock: normalizeFinancialNumber(product.stock || 0)
        });
      }
    }
  });

  productsWithCostIncrease.sort((a, b) => b.costIncreasePercent - a.costIncreasePercent);

  return {
    productsWithCostIncrease,
    count: productsWithCostIncrease.length,
    avgIncrease: productsWithCostIncrease.length > 0
      ? productsWithCostIncrease.reduce((sum, product) => sum + product.costIncreasePercent, 0) / productsWithCostIncrease.length
      : 0
  };
};

const buildAlerts = (deadStock, margins, costIncreases) => {
  const alerts = [];

  if (deadStock && deadStock.totalDeadStockValue >= CONFIG.DEAD_STOCK.MIN_INVESTMENT) {
    const topProducts = deadStock.deadStockProducts
      .slice(0, 5)
      .map(product => `• ${product.name}: ${product.currentStock} u. x ${formatCurrency(product.costPerUnit)} = ${formatCurrency(product.totalInvestment)}`)
      .join('\n');

    alerts.push({
      id: 'retail-dead-stock',
      type: deadStock.totalDeadStockValue > 5000 ? 'danger' : 'warning',
      priority: 1,
      category: 'inventory',
      title: `Capital Muerto: ${formatCurrency(deadStock.totalDeadStockValue)}`,
      message: `${deadStock.productCount} productos sin venta en ${CONFIG.DEAD_STOCK.NO_SALES_DAYS} días.\n\nTop 5:\n${topProducts}`,
      metrics: {
        deadCapital: formatCurrency(deadStock.totalDeadStockValue),
        productCount: deadStock.productCount,
        potentialRevenue: formatCurrency(deadStock.totalPotentialRevenue)
      },
      action: 'Arma promoción de liquidación o mejora exhibición de estos productos.',
      link: '/productos?filter=dead-stock'
    });
  }

  if (margins && margins.missingCostCount > 0) {
    const topProducts = margins.missingCostProducts
      .slice(0, 5)
      .map(product => `* ${product.name}: ${product.stock} u. sin costo, ventas potenciales ${formatCurrency(product.revenueAtRisk)}`)
      .join('\n');

    alerts.push({
      id: 'retail-missing-costs',
      type: margins.missingCostCount >= 5 ? 'danger' : 'warning',
      priority: 1,
      category: 'pricing',
      title: `Costos Faltantes: ${margins.missingCostCount} Productos`,
      message: `Estos productos no deben contarse como utilidad real hasta capturar costo:\n\n${topProducts}`,
      metrics: {
        missingCostProducts: margins.missingCostCount,
        revenueAtRisk: formatCurrency(margins.missingCostRevenueAtRisk)
      },
      action: 'Captura costo de compra para desbloquear margen y utilidad confiables.',
      link: '/productos?filter=missing-cost'
    });
  }

  if (margins && margins.criticalCount > 0) {
    const topProducts = margins.criticalMargin
      .slice(0, 5)
      .map(product => `• ${product.name}: Margen ${product.margin.toFixed(1)}% (${formatCurrency(product.profitPerUnit)}/u)`)
      .join('\n');

    alerts.push({
      id: 'retail-margin-critical',
      type: 'danger',
      priority: 1,
      category: 'pricing',
      title: `Márgenes Críticos: ${margins.criticalCount} Productos`,
      message: `Productos con margen menor al ${CONFIG.MARGIN.CRITICAL_THRESHOLD * 100}%:\n\n${topProducts}`,
      metrics: {
        criticalProducts: margins.criticalCount,
        avgMargin: margins.avgMargin.toFixed(1) + '%',
        impactOnProfit: formatCurrency(margins.criticalImpact)
      },
      action: 'Revisa costos con proveedores o ajusta precios de venta.',
      link: '/productos?filter=low-margin'
    });
  }

  if (margins && margins.warningCount > 0 && margins.criticalCount === 0) {
    alerts.push({
      id: 'retail-margin-warning',
      type: 'warning',
      priority: 2,
      category: 'pricing',
      title: `Márgenes Bajos: ${margins.warningCount} Productos`,
      message: `Productos con margen entre ${CONFIG.MARGIN.CRITICAL_THRESHOLD * 100}% y ${CONFIG.MARGIN.WARNING_THRESHOLD * 100}%.`,
      metrics: {
        warningProducts: margins.warningCount,
        avgMargin: margins.avgMargin.toFixed(1) + '%',
        impactOnProfit: formatCurrency(margins.warningImpact)
      },
      action: 'Considera ajustar precios o buscar proveedores alternativos.',
      link: '/productos?filter=low-margin'
    });
  }

  if (costIncreases && costIncreases.count > 0) {
    const topProducts = costIncreases.productsWithCostIncrease
      .slice(0, 3)
      .map(product => `• ${product.name}: Costo subió ${product.costIncreasePercent.toFixed(1)}% (${formatCurrency(product.previousCost)} → ${formatCurrency(product.latestCost)})`)
      .join('\n');

    alerts.push({
      id: 'retail-cost-increase',
      type: 'warning',
      priority: 2,
      category: 'pricing',
      title: `Costos en Alza: ${costIncreases.count} Productos`,
      message: `El costo de compra subió recientemente:\n\n${topProducts}`,
      metrics: {
        affectedProducts: costIncreases.count,
        avgIncrease: costIncreases.avgIncrease.toFixed(1) + '%',
        totalIncrease: formatCurrency(costIncreases.productsWithCostIncrease.reduce((sum, product) => sum + product.costIncrease * product.stock, 0))
      },
      action: `Precio sugerido para 20% margen: ${formatCurrency(costIncreases.productsWithCostIncrease[0]?.recommendedPrice || 0)}+`,
      link: '/productos?edit=' + costIncreases.productsWithCostIncrease[0]?.productId
    });
  }

  return alerts.sort((a, b) => a.priority - b.priority);
};

export const useRetailDiagnostics = (refreshKey = 0) => {
  const [diagnostics, setDiagnostics] = useState(INITIAL_STATE);

  const loadDiagnostics = useCallback(async () => {
    setDiagnostics(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const [sales, inventory, movements, batches] = await Promise.all([
        getRecentSales(CONFIG.DEAD_STOCK.ANALYSIS_SALES_DAYS),
        getActiveInventory(),
        getInventoryMovements(),
        getProductBatches()
      ]);

      const deadStock = analyzeDeadStock(sales, inventory);
      const margins = analyzeMargins(inventory);
      const costIncreases = analyzeCostIncreases(inventory, batches);
      const alerts = buildAlerts(deadStock, margins, costIncreases);

      setDiagnostics({
        alerts,
        isLoading: false,
        error: null,
        summary: {
          totalAlerts: alerts.length,
          criticalCount: alerts.filter(alert => alert.type === 'danger').length,
          deadStock,
          margins,
          costIncreases
        },
        rawData: {
          salesCount: sales.length,
          inventoryCount: inventory.length,
          movementsCount: movements.length,
          batchesCount: batches.length
        }
      });
    } catch (error) {
      console.error('[useRetailDiagnostics] Error:', error);
      setDiagnostics({
        alerts: [],
        isLoading: false,
        error: error.message || 'Error al calcular diagnóstico de retail',
        summary: null,
        rawData: null
      });
    }
  }, []);

  useEffect(() => {
    loadDiagnostics();
  }, [loadDiagnostics, refreshKey]);

  return diagnostics;
};

export default useRetailDiagnostics;
