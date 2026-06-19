/**
 * usePharmacyDiagnostics
 *
 * Hook especializado para diagnóstico operativo de farmacias.
 * Enfocado en caducidad de lotes y quiebre de stock de medicamentos de alta rotación.
 */

import { useCallback, useEffect, useState } from 'react';
import { db, STORES } from '../../services/db/dexie';

const CONFIG = {
  EXPIRATION: {
    CRITICAL_DAYS: 30,
    WARNING_DAYS: 60
  },
  STOCKOUT: {
    CRITICAL_DAYS: 3,
    WARNING_DAYS: 7,
    MIN_ROTATION_DAYS: 7,
    HIGH_ROTATION_THRESHOLD: 5
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

const getDaysUntilExpiration = (expiryDateString) => {
  if (!expiryDateString) return Infinity;
  const expiry = new Date(expiryDateString);
  const now = new Date();
  return Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
};

const calculateDaysUntilStockout = (currentStock, avgDailySales) => {
  if (avgDailySales <= 0) return Infinity;
  return Math.floor(currentStock / avgDailySales);
};

const getAllActiveBatches = async () => {
  return await db.table(STORES.PRODUCT_BATCHES)
    .filter(batch => batch.isActive !== false && Number(batch.stock || 0) > 0)
    .toArray();
};

const getMenuWithBatches = async () => {
  return await db.table(STORES.MENU)
    .filter(product => product.isActive !== false && product.batchManagement?.enabled)
    .toArray();
};

const getRecentSales = async (days = 7) => {
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

const analyzeExpirationRisk = (batches, menu) => {
  if (!batches || batches.length === 0) return null;

  const productMap = new Map(menu.map(product => [product.id, product]));
  const criticalBatches = [];
  const warningBatches = [];

  batches.forEach(batch => {
    const daysUntilExpiration = getDaysUntilExpiration(batch.expiryDate);
    const payload = {
      batchId: batch.id,
      productId: batch.productId,
      sku: batch.sku,
      productName: batch.productName || productMap.get(batch.productId)?.name || 'Desconocido',
      expiryDate: batch.expiryDate,
      daysUntilExpiration,
      stock: Number(batch.stock || 0),
      costPerUnit: Number(batch.cost || 0),
      totalCost: Number(batch.cost || 0) * Number(batch.stock || 0)
    };

    if (daysUntilExpiration <= CONFIG.EXPIRATION.CRITICAL_DAYS) {
      criticalBatches.push({ ...payload, severity: 'critical' });
    } else if (daysUntilExpiration <= CONFIG.EXPIRATION.WARNING_DAYS) {
      warningBatches.push({ ...payload, severity: 'warning' });
    }
  });

  const criticalCapital = criticalBatches.reduce((sum, batch) => sum + batch.totalCost, 0);
  const warningCapital = warningBatches.reduce((sum, batch) => sum + batch.totalCost, 0);

  return {
    criticalBatches,
    warningBatches,
    criticalCapital,
    warningCapital,
    totalCapitalAtRisk: criticalCapital + warningCapital,
    criticalCount: criticalBatches.length,
    warningCount: warningBatches.length
  };
};

const analyzeStockoutRisk = (sales, menu) => {
  if (!sales || sales.length === 0 || !menu || menu.length === 0) return null;

  const productVelocity = new Map();

  sales.forEach(sale => {
    sale.items?.forEach(item => {
      const productId = item.parentId || item.id;
      if (!productId) return;
      productVelocity.set(productId, (productVelocity.get(productId) || 0) + Number(item.quantity || 1));
    });
  });

  const criticalStockouts = [];
  const warningStockouts = [];

  menu.forEach(product => {
    const currentStock = Number(product.stock || 0);
    if (currentStock <= 0) return;

    const totalSales = productVelocity.get(product.id) || 0;
    const avgDailySales = totalSales / CONFIG.STOCKOUT.MIN_ROTATION_DAYS;
    if (avgDailySales < CONFIG.STOCKOUT.HIGH_ROTATION_THRESHOLD) return;

    const daysUntilStockout = calculateDaysUntilStockout(currentStock, avgDailySales);
    const basePayload = {
      productId: product.id,
      name: product.name,
      sku: product.sku,
      currentStock,
      avgDailySales: Number(avgDailySales.toFixed(2)),
      daysUntilStockout
    };

    if (daysUntilStockout <= CONFIG.STOCKOUT.CRITICAL_DAYS) {
      criticalStockouts.push({
        ...basePayload,
        severity: 'critical',
        estimatedLostRevenue: avgDailySales * CONFIG.STOCKOUT.CRITICAL_DAYS * Number(product.price || 0)
      });
    } else if (daysUntilStockout <= CONFIG.STOCKOUT.WARNING_DAYS) {
      warningStockouts.push({
        ...basePayload,
        severity: 'warning',
        estimatedLostRevenue: avgDailySales * (CONFIG.STOCKOUT.WARNING_DAYS - daysUntilStockout) * Number(product.price || 0)
      });
    }
  });

  const criticalRevenue = criticalStockouts.reduce((sum, product) => sum + product.estimatedLostRevenue, 0);
  const warningRevenue = warningStockouts.reduce((sum, product) => sum + product.estimatedLostRevenue, 0);

  return {
    criticalStockouts,
    warningStockouts,
    criticalRevenue,
    warningRevenue,
    totalEstimatedLostRevenue: criticalRevenue + warningRevenue,
    criticalCount: criticalStockouts.length,
    warningCount: warningStockouts.length
  };
};

const buildAlerts = (expirationRisk, stockoutRisk) => {
  const alerts = [];

  if (expirationRisk && expirationRisk.criticalCount > 0) {
    const batchList = expirationRisk.criticalBatches
      .slice(0, 3)
      .map(batch => `• ${batch.productName} (${batch.sku || 'sin SKU'}): ${batch.daysUntilExpiration} días - ${formatCurrency(batch.totalCost)}`)
      .join('\n');

    alerts.push({
      id: 'pharmacy-expiration-critical',
      type: 'danger',
      priority: 1,
      category: 'inventory',
      title: `Caducidad Crítica: ${formatCurrency(expirationRisk.criticalCapital)} en Riesgo`,
      message: `${expirationRisk.criticalCount} lote(s) caducan en menos de ${CONFIG.EXPIRATION.CRITICAL_DAYS} días.\n\n${batchList}`,
      metrics: {
        capitalAtRisk: formatCurrency(expirationRisk.criticalCapital),
        batchCount: expirationRisk.criticalCount,
        avgDaysToExpiry: Math.round(expirationRisk.criticalBatches.reduce((sum, batch) => sum + batch.daysUntilExpiration, 0) / expirationRisk.criticalCount)
      },
      action: 'Ejecuta promoción de salida inmediata o devuelve a proveedor si aplica.',
      link: '/lotes'
    });
  }

  if (expirationRisk && expirationRisk.warningCount > 0 && expirationRisk.criticalCount === 0) {
    alerts.push({
      id: 'pharmacy-expiration-warning',
      type: 'warning',
      priority: 2,
      category: 'inventory',
      title: `Caducidad Preventiva: ${formatCurrency(expirationRisk.warningCapital)} en Riesgo`,
      message: `${expirationRisk.warningCount} lote(s) caducan en ${CONFIG.EXPIRATION.CRITICAL_DAYS}-${CONFIG.EXPIRATION.WARNING_DAYS} días.`,
      metrics: {
        capitalAtRisk: formatCurrency(expirationRisk.warningCapital),
        batchCount: expirationRisk.warningCount,
        avgDaysToExpiry: Math.round(expirationRisk.warningBatches.reduce((sum, batch) => sum + batch.daysUntilExpiration, 0) / expirationRisk.warningCount)
      },
      action: 'Planifica promoción o reordenamiento de stock para rotar inventario.',
      link: '/lotes'
    });
  }

  if (stockoutRisk && stockoutRisk.criticalCount > 0) {
    const productList = stockoutRisk.criticalStockouts
      .slice(0, 3)
      .map(product => `• ${product.name}: ${product.daysUntilStockout} días (${product.avgDailySales}/día)`)
      .join('\n');

    alerts.push({
      id: 'pharmacy-stockout-critical',
      type: 'danger',
      priority: 1,
      category: 'inventory',
      title: `¡Quiebre Inminente! ${stockoutRisk.criticalCount} Productos de Alta Rotación`,
      message: `Productos críticos:\n${productList}`,
      metrics: {
        productsAtRisk: stockoutRisk.criticalCount,
        lostRevenue: formatCurrency(stockoutRisk.criticalRevenue),
        avgDaysToStockout: Math.round(stockoutRisk.criticalStockouts.reduce((sum, product) => sum + product.daysUntilStockout, 0) / stockoutRisk.criticalCount)
      },
      action: 'Reposición urgente o busca producto sustituto.',
      link: '/productos'
    });
  }

  if (stockoutRisk && stockoutRisk.warningCount > 0 && stockoutRisk.criticalCount === 0) {
    alerts.push({
      id: 'pharmacy-stockout-warning',
      type: 'warning',
      priority: 2,
      category: 'inventory',
      title: `Stock Bajo: ${stockoutRisk.warningCount} Productos de Alta Rotación`,
      message: `Productos que se agotarán en ${CONFIG.STOCKOUT.CRITICAL_DAYS}-${CONFIG.STOCKOUT.WARNING_DAYS} días.`,
      metrics: {
        productsAtRisk: stockoutRisk.warningCount,
        lostRevenue: formatCurrency(stockoutRisk.warningRevenue),
        avgDaysToStockout: Math.round(stockoutRisk.warningStockouts.reduce((sum, product) => sum + product.daysUntilStockout, 0) / stockoutRisk.warningCount)
      },
      action: 'Programa reposición antes de que se agoten.',
      link: '/productos'
    });
  }

  return alerts.sort((a, b) => a.priority - b.priority);
};

export const usePharmacyDiagnostics = (refreshKey = 0) => {
  const [diagnostics, setDiagnostics] = useState(INITIAL_STATE);

  const loadDiagnostics = useCallback(async () => {
    setDiagnostics(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const [batches, menu, sales] = await Promise.all([
        getAllActiveBatches(),
        getMenuWithBatches(),
        getRecentSales(CONFIG.STOCKOUT.MIN_ROTATION_DAYS)
      ]);

      const expirationRisk = analyzeExpirationRisk(batches, menu);
      const stockoutRisk = analyzeStockoutRisk(sales, menu);
      const alerts = buildAlerts(expirationRisk, stockoutRisk);

      setDiagnostics({
        alerts,
        isLoading: false,
        error: null,
        summary: {
          totalAlerts: alerts.length,
          criticalCount: alerts.filter(alert => alert.type === 'danger').length,
          expirationRisk,
          stockoutRisk
        },
        rawData: {
          batchesCount: batches.length,
          menuCount: menu.length,
          salesCount: sales.length
        }
      });
    } catch (error) {
      console.error('[usePharmacyDiagnostics] Error:', error);
      setDiagnostics({
        alerts: [],
        isLoading: false,
        error: error.message || 'Error al calcular diagnóstico de farmacia',
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

export default usePharmacyDiagnostics;
