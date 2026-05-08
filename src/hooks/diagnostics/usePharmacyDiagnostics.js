/**
 * usePharmacyDiagnostics
 * 
 * Hook especializado para diagnóstico operativo de farmacias.
 * Enfocado en caducidad de lotes y quiebre de stock de medicamentos de alta rotación.
 * 
 * Reglas de negocio:
 * - Capital en Riesgo: suma de costos de lotes que caducan en 30/60 días
 * - Quiebre de Stock: proyección de días para agotamiento basado en venta promedio 7 días
 * - Cero mensajes genéricos: todo debe contener $, %, días o cantidades calculadas
 */

import { useMemo } from 'react';
import { db, STORES } from '../../services/db/dexie';

// ============================================================
// CONFIGURACIÓN Y UMBRALES
// ============================================================

const CONFIG = {
  // Caducidad
  EXPIRATION: {
    CRITICAL_DAYS: 30,    // Caducidad crítica: menos de 30 días
    WARNING_DAYS: 60,     // Caducidad preventiva: menos de 60 días
    ANALYSIS_BATCH_SIZE: 1000
  },
  // Quiebre de Stock
  STOCKOUT: {
    CRITICAL_DAYS: 3,     // Se agota en 3 días o menos
    WARNING_DAYS: 7,      // Se agota en 7 días o menos
    MIN_ROTATION_DAYS: 7, // Días mínimos de historial para calcular rotación
    HIGH_ROTATION_THRESHOLD: 5 // Ventas diarias promedio para considerar "alta rotación"
  }
};

// ============================================================
// HELPERS PUROS
// ============================================================

/**
 * Calcula días restantes para caducidad
 */
const getDaysUntilExpiration = (expiryDateString) => {
  if (!expiryDateString) return Infinity;
  const expiry = new Date(expiryDateString);
  const now = new Date();
  const diffTime = expiry - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
};

/**
 * Calcula días de stock restante basado en velocidad de venta
 */
const calculateDaysUntilStockout = (currentStock, avgDailySales) => {
  if (avgDailySales <= 0) return Infinity;
  return Math.floor(currentStock / avgDailySales);
};

/**
 * Formatea moneda
 */
const formatCurrency = (amount) => `$${amount.toFixed(2)}`;

// ============================================================
// CONSULTAS A DEXIE (Optimizadas)
// ============================================================

/**
 * Obtiene todos los lotes activos con su información de caducidad
 */
const getAllActiveBatches = async () => {
  return await db.table(STORES.PRODUCT_BATCHES)
    .filter(batch => batch.isActive !== false && batch.stock > 0)
    .toArray();
};

/**
 * Obtiene productos del menú con información de lotes
 */
const getMenuWithBatches = async () => {
  return await db.table(STORES.MENU)
    .filter(product => product.isActive !== false && product.batchManagement?.enabled)
    .toArray();
};

/**
 * Obtiene ventas de los últimos N días para calcular rotación
 */
const getRecentSales = async (days = 7) => {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffISO = cutoffDate.toISOString();

  const sales = await db.table(STORES.SALES)
    .where('timestamp')
    .aboveOrEqual(cutoffISO)
    .toArray();

  return sales.filter(sale => 
    sale.status === 'closed' && 
    !sale.splitParentId &&
    Array.isArray(sale.items)
  );
};

/**
 * Obtiene todos los productos activos (para retail dentro de farmacia)
 */
const getAllActiveProducts = async () => {
  return await db.table(STORES.MENU)
    .filter(product => product.isActive !== false && product.trackStock !== false)
    .toArray();
};

// ============================================================
// CÁLCULOS DE MÉTRICAS
// ============================================================

/**
 * Analiza capital en riesgo por caducidad próxima
 */
const analyzeExpirationRisk = (batches, menu) => {
  if (!batches || batches.length === 0) {
    return null;
  }

  // Crear mapa de productos para obtener nombres
  const productMap = new Map(menu.map(p => [p.id, p]));

  const criticalBatches = []; // Caducan en < 30 días
  const warningBatches = [];  // Caducan en < 60 días

  batches.forEach(batch => {
    const daysUntilExpiration = getDaysUntilExpiration(batch.expiryDate);
    
    if (daysUntilExpiration <= CONFIG.EXPIRATION.CRITICAL_DAYS) {
      criticalBatches.push({
        batchId: batch.id,
        productId: batch.productId,
        sku: batch.sku,
        productName: batch.productName || productMap.get(batch.productId)?.name || 'Desconocido',
        expiryDate: batch.expiryDate,
        daysUntilExpiration,
        stock: Number(batch.stock || 0),
        costPerUnit: Number(batch.cost || 0),
        totalCost: Number(batch.cost || 0) * Number(batch.stock || 0),
        severity: 'critical'
      });
    } else if (daysUntilExpiration <= CONFIG.EXPIRATION.WARNING_DAYS) {
      warningBatches.push({
        batchId: batch.id,
        productId: batch.productId,
        sku: batch.sku,
        productName: batch.productName || productMap.get(batch.productId)?.name || 'Desconocido',
        expiryDate: batch.expiryDate,
        daysUntilExpiration,
        stock: Number(batch.stock || 0),
        costPerUnit: Number(batch.cost || 0),
        totalCost: Number(batch.cost || 0) * Number(batch.stock || 0),
        severity: 'warning'
      });
    }
  });

  const criticalCapital = criticalBatches.reduce((sum, b) => sum + b.totalCost, 0);
  const warningCapital = warningBatches.reduce((sum, b) => sum + b.totalCost, 0);
  const totalCapitalAtRisk = criticalCapital + warningCapital;

  return {
    criticalBatches,
    warningBatches,
    criticalCapital,
    warningCapital,
    totalCapitalAtRisk,
    criticalCount: criticalBatches.length,
    warningCount: warningBatches.length
  };
};

/**
 * Analiza quiebre de stock para productos de alta rotación
 */
const analyzeStockoutRisk = (sales, menu) => {
  if (!sales || sales.length === 0 || !menu || menu.length === 0) {
    return null;
  }

  // Calcular velocidad de venta por producto (últimos 7 días)
  const productVelocity = new Map();
  
  sales.forEach(sale => {
    sale.items?.forEach(item => {
      const productId = item.parentId || item.id;
      if (!productId) return;
      
      const current = productVelocity.get(productId) || 0;
      productVelocity.set(productId, current + (item.quantity || 1));
    });
  });

  const criticalStockouts = [];
  const warningStockouts = [];

  menu.forEach(product => {
    const currentStock = Number(product.stock || 0);
    if (currentStock <= 0) return; // Ya agotado, no es proyección

    const totalSales = productVelocity.get(product.id) || 0;
    const avgDailySales = totalSales / CONFIG.STOCKOUT.MIN_ROTATION_DAYS;

    // Solo alertar si es de alta rotación
    if (avgDailySales < CONFIG.STOCKOUT.HIGH_ROTATION_THRESHOLD) return;

    const daysUntilStockout = calculateDaysUntilStockout(currentStock, avgDailySales);

    if (daysUntilStockout <= CONFIG.STOCKOUT.CRITICAL_DAYS) {
      criticalStockouts.push({
        productId: product.id,
        name: product.name,
        sku: product.sku,
        currentStock,
        avgDailySales: parseFloat(avgDailySales.toFixed(2)),
        daysUntilStockout,
        severity: 'critical',
        estimatedLostRevenue: avgDailySales * CONFIG.STOCKOUT.CRITICAL_DAYS * (product.price || 0)
      });
    } else if (daysUntilStockout <= CONFIG.STOCKOUT.WARNING_DAYS) {
      warningStockouts.push({
        productId: product.id,
        name: product.name,
        sku: product.sku,
        currentStock,
        avgDailySales: parseFloat(avgDailySales.toFixed(2)),
        daysUntilStockout,
        severity: 'warning',
        estimatedLostRevenue: avgDailySales * (CONFIG.STOCKOUT.WARNING_DAYS - daysUntilStockout) * (product.price || 0)
      });
    }
  });

  const criticalRevenue = criticalStockouts.reduce((sum, p) => sum + p.estimatedLostRevenue, 0);
  const warningRevenue = warningStockouts.reduce((sum, p) => sum + p.estimatedLostRevenue, 0);

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

// ============================================================
// GENERACIÓN DE ALERTAS
// ============================================================

const buildAlerts = (expirationRisk, stockoutRisk) => {
  const alerts = [];

  // Alerta 1: Capital en Riesgo por Caducidad Crítica
  if (expirationRisk && expirationRisk.criticalCount > 0) {
    const batchList = expirationRisk.criticalBatches
      .slice(0, 3)
      .map(b => `• ${b.productName} (${b.sku}): ${b.daysUntilExpiration} días - ${formatCurrency(b.totalCost)}`)
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
        avgDaysToExpiry: Math.round(expirationRisk.criticalBatches.reduce((sum, b) => sum + b.daysUntilExpiration, 0) / expirationRisk.criticalCount)
      },
      action: 'Ejecuta promoción de salida inmediata o devuelve a proveedor si aplica.',
      link: '/lotes'
    });
  }

  // Alerta 2: Capital en Riesgo por Caducidad Preventiva
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
        avgDaysToExpiry: Math.round(expirationRisk.warningBatches.reduce((sum, b) => sum + b.daysUntilExpiration, 0) / expirationRisk.warningCount)
      },
      action: 'Planifica promoción o reordenamiento de stock para rotar inventario.',
      link: '/lotes'
    });
  }

  // Alerta 3: Quiebre de Stock Inminente (Alta Rotación)
  if (stockoutRisk && stockoutRisk.criticalCount > 0) {
    const productList = stockoutRisk.criticalStockouts
      .slice(0, 3)
      .map(p => `• ${p.name}: ${p.daysUntilStockout} días (${p.avgDailySales}/día)`)
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
        avgDaysToStockout: Math.round(stockoutRisk.criticalStockouts.reduce((sum, p) => sum + p.daysUntilStockout, 0) / stockoutRisk.criticalCount)
      },
      action: 'Reposición urgente o busca producto sustituto.',
      link: '/productos'
    });
  }

  // Alerta 4: Quiebre de Stock Preventivo
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
        avgDaysToStockout: Math.round(stockoutRisk.warningStockouts.reduce((sum, p) => sum + p.daysUntilStockout, 0) / stockoutRisk.warningCount)
      },
      action: 'Programa reposición antes de que se agoten.',
      link: '/productos'
    });
  }

  return alerts.sort((a, b) => a.priority - b.priority);
};

// ============================================================
// HOOK PRINCIPAL
// ============================================================

export const usePharmacyDiagnostics = () => {
  const diagnostics = useMemo(async () => {
    try {
      // Ejecutar consultas en paralelo
      const [batches, menu, sales] = await Promise.all([
        getAllActiveBatches(),
        getMenuWithBatches(),
        getRecentSales(CONFIG.STOCKOUT.MIN_ROTATION_DAYS)
      ]);

      // Calcular métricas
      const expirationRisk = analyzeExpirationRisk(batches, menu);
      const stockoutRisk = analyzeStockoutRisk(sales, menu);

      // Generar alertas
      const alerts = buildAlerts(expirationRisk, stockoutRisk);

      return {
        alerts,
        isLoading: false,
        error: null,
        summary: {
          totalAlerts: alerts.length,
          criticalCount: alerts.filter(a => a.type === 'danger').length,
          expirationRisk,
          stockoutRisk
        },
        rawData: {
          batchesCount: batches.length,
          menuCount: menu.length,
          salesCount: sales.length
        }
      };
    } catch (error) {
      console.error('[usePharmacyDiagnostics] Error:', error);
      return {
        alerts: [],
        isLoading: false,
        error: error.message,
        summary: null,
        rawData: null
      };
    }
  }, []);

  return diagnostics;
};

export default usePharmacyDiagnostics;
