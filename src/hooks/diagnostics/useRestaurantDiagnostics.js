/**
 * useRestaurantDiagnostics
 *
 * Hook especializado para diagnóstico operativo de restaurantes y dark kitchens.
 * Calcula métricas estrictas basadas en datos reales de Dexie (ventas, mermas, productos).
 */

import { useCallback, useEffect, useState } from 'react';
import { db, STORES } from '../../services/db/dexie';

const CONFIG = {
  TICKET_ANALYSIS: {
    MIN_SALES_FOR_ANALYSIS: 10,
    FOOD_CATEGORIES: ['boneless', 'alitas', 'hamburguesa', 'pizza', 'taco', 'platillo', 'orden', 'comida'],
    DRINK_CATEGORIES: ['refresco', 'cerveza', 'agua', 'jugo', 'bebida', 'latte', 'cafe', 'té'],
    EXTRA_CATEGORIES: ['papas', 'aros', 'nachos', 'guacamole', 'salsa', 'aderezo']
  },
  WASTE: {
    HIGH_WASTE_RATIO: 0.04,
    CRITICAL_WASTE_RATIO: 0.08,
    ANALYSIS_DAYS: 7
  },
  STOCK: {
    LOW_STOCK_DAYS: 3,
    STOCKOUT_IMMINENT_DAYS: 1
  }
};

const INITIAL_STATE = {
  alerts: [],
  isLoading: true,
  error: null,
  summary: null,
  rawData: null
};

const normalizeText = (text) => {
  if (!text) return '';
  return String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
};

const classifyProduct = (item) => {
  const name = normalizeText(item.name || '');
  const category = normalizeText(item.categoryName || item.category || '');
  const combined = `${name} ${category}`;

  return {
    isFood: CONFIG.TICKET_ANALYSIS.FOOD_CATEGORIES.some(keyword => combined.includes(keyword)),
    isDrink: CONFIG.TICKET_ANALYSIS.DRINK_CATEGORIES.some(keyword => combined.includes(keyword)),
    isExtra: CONFIG.TICKET_ANALYSIS.EXTRA_CATEGORIES.some(keyword => combined.includes(keyword))
  };
};

const calculateGrossProfit = (sale) => {
  const revenue = Number(sale.total || 0);
  const cost = (sale.items || []).reduce((sum, item) => {
    return sum + (Number(item.cost || 0) * Number(item.quantity || 1));
  }, 0);
  return revenue - cost;
};

const calculateDaysUntilStockout = (currentStock, avgDailySales) => {
  if (avgDailySales <= 0) return Infinity;
  return Math.floor(currentStock / avgDailySales);
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
    return isClosed && !sale.splitParentId && Array.isArray(sale.items) && sale.items.length > 0;
  });
};

const getRecentWaste = async (days = 7) => {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffISO = cutoffDate.toISOString();

  return await db.table(STORES.WASTE)
    .where('timestamp')
    .aboveOrEqual(cutoffISO)
    .toArray();
};

const getActiveMenu = async () => {
  return await db.table(STORES.MENU)
    .filter(product => product.isActive !== false && product.trackStock !== false)
    .toArray();
};

const analyzeTicketLeakage = (sales) => {
  if (!sales || sales.length < CONFIG.TICKET_ANALYSIS.MIN_SALES_FOR_ANALYSIS) return null;

  const ticketsWithFood = [];
  const ticketsWithFoodNoDrinks = [];

  sales.forEach(sale => {
    const hasFood = sale.items.some(item => classifyProduct(item).isFood);
    const hasDrinks = sale.items.some(item => classifyProduct(item).isDrink);
    const hasExtras = sale.items.some(item => classifyProduct(item).isExtra);

    if (hasFood) {
      ticketsWithFood.push(sale);
      if (!hasDrinks && !hasExtras) ticketsWithFoodNoDrinks.push(sale);
    }
  });

  const totalFoodTickets = ticketsWithFood.length;
  const leakedTickets = ticketsWithFoodNoDrinks.length;
  const leakageRate = totalFoodTickets > 0 ? leakedTickets / totalFoodTickets : 0;
  const drinkSales = sales.filter(s => s.items.some(i => classifyProduct(i).isDrink));
  const avgDrinkPrice = sales.reduce((sum, sale) => {
    const drinkTotal = sale.items
      .filter(item => classifyProduct(item).isDrink)
      .reduce((subtotal, item) => subtotal + (Number(item.price || 0) * Number(item.quantity || 1)), 0);

    return drinkTotal > 0 ? sum + drinkTotal : sum;
  }, 0) / (drinkSales.length || 1);

  return {
    totalFoodTickets,
    leakedTickets,
    leakageRate,
    potentialLostRevenue: leakedTickets * avgDrinkPrice,
    avgDrinkPrice
  };
};

const analyzeWasteImpact = (wasteLogs, sales) => {
  if (!wasteLogs || wasteLogs.length === 0) return null;

  const totalWasteCost = wasteLogs.reduce((sum, waste) => {
    return sum + (Number(waste.lossAmount || waste.cost || 0) || 0);
  }, 0);

  const totalGrossProfit = sales.reduce((sum, sale) => sum + calculateGrossProfit(sale), 0);

  if (totalGrossProfit <= 0) {
    return {
      totalWasteCost,
      grossProfit: 0,
      wasteRatio: 1,
      isCritical: true,
      isHigh: true
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

const analyzeLowStock = (menu, sales) => {
  if (!menu || menu.length === 0) return [];

  const productVelocity = new Map();

  sales.forEach(sale => {
    sale.items?.forEach(item => {
      const productId = item.parentId || item.id;
      if (!productId) return;
      productVelocity.set(productId, (productVelocity.get(productId) || 0) + Number(item.quantity || 1));
    });
  });

  return menu
    .map(product => {
      const currentStock = Number(product.stock || 0);
      if (currentStock <= 0) return null;

      const avgDailySales = (productVelocity.get(product.id) || 0) / CONFIG.WASTE.ANALYSIS_DAYS;
      const daysUntilStockout = calculateDaysUntilStockout(currentStock, avgDailySales);

      if (daysUntilStockout <= CONFIG.STOCK.STOCKOUT_IMMINENT_DAYS) {
        return {
          productId: product.id,
          name: product.name,
          currentStock,
          avgDailySales,
          daysUntilStockout,
          severity: 'critical',
          estimatedLostSales: avgDailySales * CONFIG.STOCK.STOCKOUT_IMMINENT_DAYS
        };
      }

      if (daysUntilStockout <= CONFIG.STOCK.LOW_STOCK_DAYS) {
        return {
          productId: product.id,
          name: product.name,
          currentStock,
          avgDailySales,
          daysUntilStockout,
          severity: 'warning'
        };
      }

      return null;
    })
    .filter(Boolean)
    .sort((a, b) => a.daysUntilStockout - b.daysUntilStockout);
};

const buildAlerts = (ticketLeakage, wasteImpact, lowStockProducts) => {
  const alerts = [];

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

  if (wasteImpact && (wasteImpact.isHigh || wasteImpact.isCritical)) {
    alerts.push({
      id: 'restaurant-waste-impact',
      type: wasteImpact.isCritical ? 'danger' : 'warning',
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

  lowStockProducts.forEach(product => {
    const isCritical = product.severity === 'critical';
    alerts.push({
      id: `restaurant-stock-${product.productId}`,
      type: isCritical ? 'danger' : 'warning',
      priority: isCritical ? 1 : 2,
      category: 'inventory',
      title: `${isCritical ? '¡QUIEBRE' : 'BAJO'} STOCK: ${product.name}`,
      message: `Stock actual: ${product.currentStock} unidades. Velocidad: ${product.avgDailySales.toFixed(1)}/día. ${isCritical ? 'Riesgo inmediato de agotarse.' : `Se agota en ${product.daysUntilStockout} días.`}`,
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

export const useRestaurantDiagnostics = (refreshKey = 0) => {
  const [diagnostics, setDiagnostics] = useState(INITIAL_STATE);

  const loadDiagnostics = useCallback(async () => {
    setDiagnostics(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const [sales, wasteLogs, menu] = await Promise.all([
        getRecentSales(CONFIG.WASTE.ANALYSIS_DAYS),
        getRecentWaste(CONFIG.WASTE.ANALYSIS_DAYS),
        getActiveMenu()
      ]);

      const ticketLeakage = analyzeTicketLeakage(sales);
      const wasteImpact = analyzeWasteImpact(wasteLogs, sales);
      const lowStockProducts = analyzeLowStock(menu, sales);
      const alerts = buildAlerts(ticketLeakage, wasteImpact, lowStockProducts);

      setDiagnostics({
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
      });
    } catch (error) {
      console.error('[useRestaurantDiagnostics] Error:', error);
      setDiagnostics({
        alerts: [],
        isLoading: false,
        error: error.message || 'Error al calcular diagnóstico de restaurante',
        summary: null,
        rawData: null
      });
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    const run = async () => {
      await loadDiagnostics();
    };

    if (isMounted) run();

    return () => {
      isMounted = false;
    };
  }, [loadDiagnostics, refreshKey]);

  return diagnostics;
};

export default useRestaurantDiagnostics;
