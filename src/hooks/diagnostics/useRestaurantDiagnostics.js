/**
 * useRestaurantDiagnostics
 * 
 * Hook especializado para diagnóstico operativo de restaurantes y dark kitchens.
 * Calcula métricas estrictas basadas en datos reales de Dexie (ventas, mermas, productos).
 * 
 * Reglas de negocio:
 * - Cero mensajes genéricos: todo debe contener $, %, días o cantidades calculadas
 * - Memoización agresiva para evitar recálculos costosos
 * - Consultas asíncronas optimizadas a IndexedDB
 */

import { useMemo } from 'react';
import { db, STORES } from '../../services/db/dexie';

// ============================================================
// CONFIGURACIÓN Y UMBRALES
// ============================================================

const CONFIG = {
  // Análisis de tickets
  TICKET_ANALYSIS: {
    MIN_SALES_FOR_ANALYSIS: 10,
    FOOD_CATEGORIES: ['boneless', 'alitas', 'hamburguesa', 'pizza', 'taco', 'platillo', 'orden', 'comida'],
    DRINK_CATEGORIES: ['refresco', 'cerveza', 'agua', 'jugo', 'bebida', 'latte', 'cafe', 'té'],
    EXTRA_CATEGORIES: ['papas', 'aros', 'nachos', 'guacamole', 'salsa', 'aderezo']
  },
  // Mermas
  WASTE: {
    HIGH_WASTE_RATIO: 0.04,      // 4% de mermas sobre utilidad es alto
    CRITICAL_WASTE_RATIO: 0.08,  // 8% es crítico
    ANALYSIS_DAYS: 7             // Última semana
  },
  // Stock
  STOCK: {
    LOW_STOCK_DAYS: 3,           // Alerta si queda para menos de 3 días
    STOCKOUT_IMMINENT_DAYS: 1    // Crítico si queda para 1 día o menos
  }
};

// ============================================================
// HELPERS PUROS (Sin efectos secundarios)
// ============================================================

/**
 * Normaliza nombre para búsqueda insensible a mayúsculas
 */
const normalizeText = (text) => {
  if (!text) return '';
  return String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
};

/**
 * Clasifica un producto como comida, bebida o extra basado en nombre/categoría
 */
const classifyProduct = (item) => {
  const name = normalizeText(item.name || '');
  const category = normalizeText(item.categoryName || item.category || '');
  const combined = `${name} ${category}`;

  const isFood = CONFIG.TICKET_ANALYSIS.FOOD_CATEGORIES.some(keyword => combined.includes(keyword));
  const isDrink = CONFIG.TICKET_ANALYSIS.DRINK_CATEGORIES.some(keyword => combined.includes(keyword));
  const isExtra = CONFIG.TICKET_ANALYSIS.EXTRA_CATEGORIES.some(keyword => combined.includes(keyword));

  return { isFood, isDrink, isExtra };
};

/**
 * Calcula la utilidad bruta de una venta
 */
const calculateGrossProfit = (sale) => {
  const revenue = sale.total || 0;
  const cost = (sale.items || []).reduce((sum, item) => {
    return sum + ((item.cost || 0) * (item.quantity || 1));
  }, 0);
  return revenue - cost;
};

/**
 * Calcula días de stock restante basado en velocidad de venta
 */
const calculateDaysUntilStockout = (currentStock, avgDailySales) => {
  if (avgDailySales <= 0) return Infinity;
  return Math.floor(currentStock / avgDailySales);
};

// ============================================================
// CONSULTAS A DEXIE (Optimizadas)
// ============================================================

/**
 * Obtiene ventas de los últimos N días
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
    Array.isArray(sale.items) && 
    sale.items.length > 0
  );
};

/**
 * Obtiene mermas de los últimos N días
 */
const getRecentWaste = async (days = 7) => {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffISO = cutoffDate.toISOString();

  return await db.table(STORES.WASTE)
    .where('timestamp')
    .aboveOrEqual(cutoffISO)
    .toArray();
};

/**
 * Obtiene productos activos del menú
 */
const getActiveMenu = async () => {
  return await db.table(STORES.MENU)
    .filter(product => product.isActive !== false && product.trackStock !== false)
    .toArray();
};

// ============================================================
// CÁLCULOS DE MÉTRICAS
// ============================================================

/**
 * Analiza fuga de ticket: tickets con comida pero sin bebidas/extras
 */
const analyzeTicketLeakage = (sales) => {
  if (!sales || sales.length < CONFIG.TICKET_ANALYSIS.MIN_SALES_FOR_ANALYSIS) {
    return null;
  }

  const ticketsWithFood = [];
  const ticketsWithFoodNoDrinks = [];

  sales.forEach(sale => {
    const hasFood = sale.items.some(item => {
      const { isFood } = classifyProduct(item);
      return isFood;
    });

    const hasDrinks = sale.items.some(item => {
      const { isDrink } = classifyProduct(item);
      return isDrink;
    });

    const hasExtras = sale.items.some(item => {
      const { isExtra } = classifyProduct(item);
      return isExtra;
    });

    if (hasFood) {
      ticketsWithFood.push(sale);
      if (!hasDrinks && !hasExtras) {
        ticketsWithFoodNoDrinks.push(sale);
      }
    }
  });

  const totalFoodTickets = ticketsWithFood.length;
  const leakedTickets = ticketsWithFoodNoDrinks.length;
  const leakageRate = totalFoodTickets > 0 ? leakedTickets / totalFoodTickets : 0;

  // Calcular dinero potencial perdido (promedio de bebida * tickets fugados)
  const avgDrinkPrice = sales.reduce((sum, sale) => {
    const drinkItems = sale.items.filter(item => {
      const { isDrink } = classifyProduct(item);
      return isDrink;
    });
    const drinkTotal = drinkItems.reduce((s, i) => s + ((i.price || 0) * (i.quantity || 1)), 0);
    return drinkTotal > 0 ? sum + drinkTotal : sum;
  }, 0) / (sales.filter(s => s.items.some(i => classifyProduct(i).isDrink)).length || 1);

  const potentialLostRevenue = leakedTickets * avgDrinkPrice;

  return {
    totalFoodTickets,
    leakedTickets,
    leakageRate,
    potentialLostRevenue,
    avgDrinkPrice
  };
};

/**
 * Analiza impacto de mermas sobre utilidad
 */
const analyzeWasteImpact = (wasteLogs, sales) => {
  if (!wasteLogs || wasteLogs.length === 0) {
    return null;
  }

  const totalWasteCost = wasteLogs.reduce((sum, w) => {
    return sum + (Number(w.lossAmount || w.cost || 0) || 0);
  }, 0);

  const totalGrossProfit = sales.reduce((sum, sale) => {
    return sum + calculateGrossProfit(sale);
  }, 0);

  if (totalGrossProfit <= 0) {
    return {
      totalWasteCost,
      grossProfit: 0,
      wasteRatio: 1, // 100% - situación crítica
      isCritical: true
    };
  }

  const wasteRatio = totalWasteCost / totalGrossProfit;

  return {
    totalWasteCost,
    grossProfit: totalGrossProfit,
    wasteRatio,
    isCritical: wasteRatio >= CONFIG.WASTE.CRITICAL_WASTE_RATIO,
    isHigh: wasteRatio >= CONFIG.WASTE.HIGH_WASTE_RATIO
  };
};

/**
 * Analiza productos con bajo stock proyectado
 */
const analyzeLowStock = (menu, sales) => {
  if (!menu || menu.length === 0) {
    return [];
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

  const lowStockProducts = [];

  menu.forEach(product => {
    const currentStock = Number(product.stock || 0);
    if (currentStock <= 0) return;

    const avgDailySales = (productVelocity.get(product.id) || 0) / 7;
    const daysUntilStockout = calculateDaysUntilStockout(currentStock, avgDailySales);

    if (daysUntilStockout <= CONFIG.STOCK.STOCKOUT_IMMINENT_DAYS) {
      lowStockProducts.push({
        productId: product.id,
        name: product.name,
        currentStock,
        avgDailySales,
        daysUntilStockout,
        severity: 'critical',
        estimatedLostSales: avgDailySales * CONFIG.STOCK.STOCKOUT_IMMINENT_DAYS // Ventas que podría perder
      });
    } else if (daysUntilStockout <= CONFIG.STOCK.LOW_STOCK_DAYS) {
      lowStockProducts.push({
        productId: product.id,
        name: product.name,
        currentStock,
        avgDailySales,
        daysUntilStockout,
        severity: 'warning'
      });
    }
  });

  return lowStockProducts.sort((a, b) => a.daysUntilStockout - b.daysUntilStockout);
};

// ============================================================
// GENERACIÓN DE ALERTAS
// ============================================================

const buildAlerts = (ticketLeakage, wasteImpact, lowStockProducts) => {
  const alerts = [];

  // Alerta 1: Fuga de Ticket
  if (ticketLeakage && ticketLeakage.leakageRate > 0.3) {
    alerts.push({
      id: 'restaurant-ticket-leakage',
      type: ticketLeakage.leakageRate > 0.5 ? 'danger' : 'warning',
      priority: 1,
      category: 'revenue',
      title: `Fuga de Ticket: ${Math.round(ticketLeakage.leakageRate * 100)}%`,
      message: `De ${ticketLeakage.totalFoodTickets} tickets con comida, ${ticketLeakage.leakedTickets} no incluyen bebidas ni extras.`,
      metrics: {
        leakageRate: `${Math.round(ticketLeakage.leakageRate * 100)}%`,
        affectedTickets: ticketLeakage.leakedTickets,
        potentialLostRevenue: `$${ticketLeakage.potentialLostRevenue.toFixed(2)}`,
        avgDrinkPrice: `$${ticketLeakage.avgDrinkPrice.toFixed(2)}`
      },
      action: 'Entrena al personal para sugerir bebidas y extras en cada orden de comida.',
      link: '/ventas'
    });
  }

  // Alerta 2: Impacto de Merma
  if (wasteImpact && (wasteImpact.isHigh || wasteImpact.isCritical)) {
    const severity = wasteImpact.isCritical ? 'danger' : 'warning';
    alerts.push({
      id: 'restaurant-waste-impact',
      type: severity,
      priority: 1,
      category: 'operations',
      title: `Merma: ${Math.round(wasteImpact.wasteRatio * 100)}% de la Utilidad`,
      message: `Perdiste $${wasteImpact.totalWasteCost.toFixed(2)} en mermas sobre $${wasteImpact.grossProfit.toFixed(2)} de utilidad bruta.`,
      metrics: {
        wasteCost: `$${wasteImpact.totalWasteCost.toFixed(2)}`,
        grossProfit: `$${wasteImpact.grossProfit.toFixed(2)}`,
        wasteRatio: `${Math.round(wasteImpact.wasteRatio * 100)}%`
      },
      action: wasteImpact.isCritical 
        ? 'Revisa inmediatamente procesos de almacenamiento y porcionamiento.'
        : 'Implementa control de porciones y revisa fechas de caducidad.',
      link: '/ventas?tab=waste'
    });
  }

  // Alerta 3: Quiebre de Stock Inminente
  lowStockProducts.forEach((product, index) => {
    const isCritical = product.severity === 'critical';
    alerts.push({
      id: `restaurant-stock-${product.productId}`,
      type: isCritical ? 'danger' : 'warning',
      priority: isCritical ? 1 : 2,
      category: 'inventory',
      title: `${isCritical ? '¡QUEDIÓ' : 'BAJO'} STOCK: ${product.name}`,
      message: `Stock actual: ${product.currentStock} unidades. Velocidad: ${product.avgDailySales.toFixed(1)}/día. ${isCritical ? '¡HOYO!' : `Se agota en ${product.daysUntilStockout} días.`}`,
      metrics: {
        currentStock: product.currentStock,
        avgDailySales: product.avgDailySales.toFixed(1),
        daysUntilStockout: product.daysUntilStockout,
        estimatedLostSales: isCritical ? Math.round(product.estimatedLostSales) : null
      },
      action: isCritical ? 'Reposición urgente o ajusta menú temporalmente.' : 'Programa reposición antes de que se agote.',
      link: `/productos?edit=${product.productId}`
    });
  });

  return alerts.sort((a, b) => a.priority - b.priority);
};

// ============================================================
// HOOK PRINCIPAL
// ============================================================

export const useRestaurantDiagnostics = () => {
  // Estado de carga y datos
  const diagnostics = useMemo(async () => {
    try {
      // Ejecutar consultas en paralelo
      const [sales, wasteLogs, menu] = await Promise.all([
        getRecentSales(CONFIG.WASTE.ANALYSIS_DAYS),
        getRecentWaste(CONFIG.WASTE.ANALYSIS_DAYS),
        getActiveMenu()
      ]);

      // Calcular métricas
      const ticketLeakage = analyzeTicketLeakage(sales);
      const wasteImpact = analyzeWasteImpact(wasteLogs, sales);
      const lowStockProducts = analyzeLowStock(menu, sales);

      // Generar alertas
      const alerts = buildAlerts(ticketLeakage, wasteImpact, lowStockProducts);

      return {
        alerts,
        isLoading: false,
        error: null,
        summary: {
          totalAlerts: alerts.length,
          criticalCount: alerts.filter(a => a.type === 'danger').length,
          ticketLeakage,
          wasteImpact,
          lowStockCount: lowStockProducts.length
        },
        rawData: {
          salesCount: sales.length,
          wasteLogsCount: wasteLogs.length,
          menuCount: menu.length
        }
      };
    } catch (error) {
      console.error('[useRestaurantDiagnostics] Error:', error);
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

export default useRestaurantDiagnostics;
