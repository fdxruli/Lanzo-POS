/**
 * useRetailDiagnostics
 * 
 * Hook especializado para diagnóstico operativo de retail y abarrotes.
 * Enfocado en capital muerto (productos sin venta) y alertas de margen.
 * 
 * Reglas de negocio:
 * - Capital Muerto: monto invertido en productos sin venta en últimos 45 días
 * - Alerta de Margen: productos con margen < 20% por aumento de costo
 * - Cero mensajes genéricos: todo debe contener $, %, días o cantidades calculadas
 */

import { useMemo } from 'react';
import { db, STORES } from '../../services/db/dexie';

// ============================================================
// CONFIGURACIÓN Y UMBRALES
// ============================================================

const CONFIG = {
  // Capital Muerto
  DEAD_STOCK: {
    NO_SALES_DAYS: 45,        // Días sin venta para considerar "muerto"
    MIN_INVESTMENT: 500,      // Monto mínimo invertido para alertar
    ANALYSIS_SALES_DAYS: 60   // Ventas a analizar (un poco más que NO_SALES_DAYS)
  },
  // Margen
  MARGIN: {
    CRITICAL_THRESHOLD: 0.15,  // 15% margen crítico
    WARNING_THRESHOLD: 0.20,   // 20% margen bajo
    MIN_DATA_POINTS: 5         // Mínimas compras para analizar tendencia de costo
  }
};

// ============================================================
// HELPERS PUROS
// ============================================================

/**
 * Calcula margen de ganancia
 */
const calculateMargin = (price, cost) => {
  if (!price || price <= 0) return 0;
  if (!cost || cost <= 0) return 1; // 100% margen si costo es 0
  return (price - cost) / price;
};

/**
 * Formatea moneda
 */
const formatCurrency = (amount) => `$${amount.toFixed(2)}`;

/**
 * Calcula días desde una fecha ISO
 */
const getDaysSince = (isoDateString) => {
  if (!isoDateString) return Infinity;
  const then = new Date(isoDateString);
  const now = new Date();
  const diffTime = now - then;
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
};

// ============================================================
// CONSULTAS A DEXIE (Optimizadas)
// ============================================================

/**
 * Obtiene ventas de los últimos N días
 */
const getRecentSales = async (days = 60) => {
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
 * Obtiene todos los productos activos con stock
 */
const getActiveInventory = async () => {
  return await db.table(STORES.MENU)
    .filter(product => 
      product.isActive !== false && 
      product.trackStock !== false &&
      (product.stock || 0) > 0
    )
    .toArray();
};

/**
 * Obtiene historial de compras/entradas de inventario para análisis de costos
 * Nota: Esto depende de si hay una tabla de compras o movimientos de entrada
 */
const getInventoryMovements = async () => {
  try {
    // Intentar obtener movimientos de caja que puedan indicar compras
    // Esto es un fallback - idealmente habría una tabla de 'purchases'
    return await db.table(STORES.MOVIMIENTOS_CAJA)
      .filter(mov => mov.tipo === 'salida' && mov.categoria?.includes('compra'))
      .toArray();
  } catch {
    return [];
  }
};

// ============================================================
// CÁLCULOS DE MÉTRICAS
// ============================================================

/**
 * Analiza capital muerto: productos sin venta en últimos N días
 */
const analyzeDeadStock = (sales, inventory) => {
  if (!inventory || inventory.length === 0) {
    return null;
  }

  // Crear Set de productos que SÍ tuvieron venta
  const soldProductIds = new Set();
  
  sales.forEach(sale => {
    sale.items?.forEach(item => {
      const productId = item.parentId || item.id;
      if (productId) soldProductIds.add(productId);
    });
  });

  // Identificar productos sin venta
  const deadStockProducts = [];
  let totalDeadStockValue = 0;

  inventory.forEach(product => {
    if (soldProductIds.has(product.id)) return; // Tuvo venta, no es muerto

    const stockValue = (product.cost || 0) * (product.stock || 0);
    
    if (stockValue >= CONFIG.DEAD_STOCK.MIN_INVESTMENT) {
      deadStockProducts.push({
        productId: product.id,
        name: product.name,
        sku: product.sku,
        category: product.categoryName || product.category,
        currentStock: product.stock || 0,
        costPerUnit: product.cost || 0,
        pricePerUnit: product.price || 0,
        totalInvestment: stockValue,
        potentialRevenue: (product.price || 0) * (product.stock || 0),
        lastSaleDate: null // No tuvo venta en el período
      });
      totalDeadStockValue += stockValue;
    }
  });

  // Ordenar por inversión descendente
  deadStockProducts.sort((a, b) => b.totalInvestment - a.totalInvestment);

  return {
    deadStockProducts,
    totalDeadStockValue,
    productCount: deadStockProducts.length,
    totalPotentialRevenue: deadStockProducts.reduce((sum, p) => sum + p.potentialRevenue, 0)
  };
};

/**
 * Analiza márgenes actuales y detecta productos con margen bajo
 */
const analyzeMargins = (inventory) => {
  if (!inventory || inventory.length === 0) {
    return null;
  }

  const criticalMargin = [];
  const warningMargin = [];
  const healthyMargin = [];

  inventory.forEach(product => {
    const margin = calculateMargin(product.price, product.cost);
    const marginPercent = margin * 100;
    const profitPerUnit = (product.price || 0) - (product.cost || 0);

    const productData = {
      productId: product.id,
      name: product.name,
      sku: product.sku,
      category: product.categoryName || product.category,
      cost: product.cost || 0,
      price: product.price || 0,
      margin: marginPercent,
      profitPerUnit,
      stock: product.stock || 0,
      totalProfitPotential: profitPerUnit * (product.stock || 0)
    };

    if (margin < CONFIG.MARGIN.CRITICAL_THRESHOLD) {
      criticalMargin.push(productData);
    } else if (margin < CONFIG.MARGIN.WARNING_THRESHOLD) {
      warningMargin.push(productData);
    } else {
      healthyMargin.push(productData);
    }
  });

  // Calcular impacto total
  const criticalImpact = criticalMargin.reduce((sum, p) => sum + p.totalProfitPotential, 0);
  const warningImpact = warningMargin.reduce((sum, p) => sum + p.totalProfitPotential, 0);

  return {
    criticalMargin,
    warningMargin,
    healthyMargin,
    criticalImpact,
    warningImpact,
    criticalCount: criticalMargin.length,
    warningCount: warningMargin.length,
    healthyCount: healthyMargin.length,
    avgMargin: inventory.length > 0 
      ? inventory.reduce((sum, p) => sum + calculateMargin(p.price, p.cost), 0) / inventory.length * 100 
      : 0
  };
};

/**
 * Detecta productos cuyo costo ha subido recientemente (comparación con batch management)
 */
const analyzeCostIncreases = (inventory, batches) => {
  if (!inventory || inventory.length === 0 || !batches || batches.length === 0) {
    return null;
  }

  // Agrupar lotes por producto
  const batchesByProduct = new Map();
  batches.forEach(batch => {
    const list = batchesByProduct.get(batch.productId) || [];
    list.push(batch);
    batchesByProduct.set(batch.productId, list);
  });

  const productsWithCostIncrease = [];

  inventory.forEach(product => {
    const productBatches = batchesByProduct.get(product.id) || [];
    if (productBatches.length < 2) return; // No hay histórico suficiente

    // Ordenar lotes por fecha de creación/caducidad
    const sortedBatches = productBatches.sort((a, b) => 
      new Date(b.createdAt || b.expiryDate || 0) - new Date(a.createdAt || a.expiryDate || 0)
    );

    const latestBatch = sortedBatches[0];
    const previousBatch = sortedBatches[1];

    const latestCost = Number(latestBatch.cost || 0);
    const previousCost = Number(previousBatch.cost || 0);

    if (previousCost <= 0) return;

    const costIncrease = latestCost - previousCost;
    const costIncreasePercent = (costIncrease / previousCost) * 100;

    // Si el costo subió más de 10% y el margen actual es bajo
    if (costIncreasePercent > 10) {
      const currentMargin = calculateMargin(product.price, latestCost);
      
      if (currentMargin < CONFIG.MARGIN.WARNING_THRESHOLD) {
        productsWithCostIncrease.push({
          productId: product.id,
          name: product.name,
          sku: product.sku,
          previousCost,
          latestCost,
          costIncrease: costIncrease,
          costIncreasePercent,
          currentPrice: product.price,
          currentMargin: currentMargin * 100,
          recommendedPrice: latestCost / (1 - CONFIG.MARGIN.WARNING_THRESHOLD), // Precio para 20% margen
          stock: product.stock || 0
        });
      }
    }
  });

  // Ordenar por porcentaje de aumento
  productsWithCostIncrease.sort((a, b) => b.costIncreasePercent - a.costIncreasePercent);

  return {
    productsWithCostIncrease,
    count: productsWithCostIncrease.length,
    avgIncrease: productsWithCostIncrease.length > 0
      ? productsWithCostIncrease.reduce((sum, p) => sum + p.costIncreasePercent, 0) / productsWithCostIncrease.length
      : 0
  };
};

// ============================================================
// GENERACIÓN DE ALERTAS
// ============================================================

const buildAlerts = (deadStock, margins, costIncreases) => {
  const alerts = [];

  // Alerta 1: Capital Muerto
  if (deadStock && deadStock.totalDeadStockValue >= CONFIG.DEAD_STOCK.MIN_INVESTMENT) {
    const topProducts = deadStock.deadStockProducts
      .slice(0, 5)
      .map(p => `• ${p.name}: ${p.currentStock} u. x ${formatCurrency(p.costPerUnit)} = ${formatCurrency(p.totalInvestment)}`)
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

  // Alerta 2: Márgenes Críticos
  if (margins && margins.criticalCount > 0) {
    const topProducts = margins.criticalMargin
      .slice(0, 5)
      .map(p => `• ${p.name}: Margen ${p.margin.toFixed(1)}% (${formatCurrency(p.profitPerUnit)}/u)`)
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

  // Alerta 3: Márgenes en Zona de Advertencia
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

  // Alerta 4: Aumento de Costos
  if (costIncreases && costIncreases.count > 0) {
    const topProducts = costIncreases.productsWithCostIncrease
      .slice(0, 3)
      .map(p => `• ${p.name}: Costo subió ${p.costIncreasePercent.toFixed(1)}% (${formatCurrency(p.previousCost)} → ${formatCurrency(p.latestCost)})`)
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
        totalIncrease: formatCurrency(costIncreases.productsWithCostIncrease.reduce((sum, p) => sum + p.costIncrease * p.stock, 0))
      },
      action: `Precio sugerido para 20% margen: ${formatCurrency(costIncreases.productsWithCostIncrease[0]?.recommendedPrice || 0)}+`,
      link: '/productos?edit=' + costIncreases.productsWithCostIncrease[0]?.productId
    });
  }

  return alerts.sort((a, b) => a.priority - b.priority);
};

// ============================================================
// HOOK PRINCIPAL
// ============================================================

export const useRetailDiagnostics = () => {
  const diagnostics = useMemo(async () => {
    try {
      // Ejecutar consultas en paralelo
      const [sales, inventory, movements, batches] = await Promise.all([
        getRecentSales(CONFIG.DEAD_STOCK.ANALYSIS_SALES_DAYS),
        getActiveInventory(),
        getInventoryMovements(),
        db.table(STORES.PRODUCT_BATCHES).toArray()
      ]);

      // Calcular métricas
      const deadStock = analyzeDeadStock(sales, inventory);
      const margins = analyzeMargins(inventory);
      const costIncreases = analyzeCostIncreases(inventory, batches);

      // Generar alertas
      const alerts = buildAlerts(deadStock, margins, costIncreases);

      return {
        alerts,
        isLoading: false,
        error: null,
        summary: {
          totalAlerts: alerts.length,
          criticalCount: alerts.filter(a => a.type === 'danger').length,
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
      };
    } catch (error) {
      console.error('[useRetailDiagnostics] Error:', error);
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

export default useRetailDiagnostics;
