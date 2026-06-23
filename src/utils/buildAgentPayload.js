/**
 * Build Agent Payload - Capa de agregación de datos para agentes de IA
 * 
 * Simula extraer datos de IndexedDB y devuelve un JSON estrictamente resumido
 * (sumar totales, listar top items, NO datos crudos completos)
 */

import { summarizeFinancialSales } from '../services/sales/financialPolicy';

// ============================================================
// 1. CONFIGURACIÓN Y CONSTANTES
// ============================================================

const DATE_RANGES = {
  TODAY: 'today',
  LAST_7_DAYS: 'last7days',
  LAST_30_DAYS: 'last30days',
  THIS_MONTH: 'thisMonth',
  LAST_MONTH: 'lastMonth',
  CUSTOM: 'custom'
};

const AGENT_TYPES = {
  INVENTORY_AUDITOR: 'inventoryAuditor',
  FINANCIAL_ANALYST: 'financialAnalyst',
  CUSTOMER_STRATEGIST: 'customerStrategist'
};

// Límites para evitar enviar datos crudos
const PAYLOAD_LIMITS = {
  MAX_TOP_PRODUCTS: 10,
  MAX_TOP_CUSTOMERS: 10,
  MAX_PAYMENT_METHODS: 5,
  MAX_DAYS_ANALYSIS: 7,
  MAX_CATEGORIES: 10
};

// ============================================================
// 2. UTILIDADES DE FECHA
// ============================================================

/**
 * Obtiene el rango de fechas en formato { start, end } para Dexie
 */
export const getDateRangeBounds = (rangeType, customStart = null, customEnd = null) => {
  const now = new Date();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (rangeType) {
    case DATE_RANGES.TODAY:
      return { start: todayStart, end: todayEnd };

    case DATE_RANGES.LAST_7_DAYS:
      return {
        start: new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000),
        end: todayEnd
      };

    case DATE_RANGES.LAST_30_DAYS:
      return {
        start: new Date(todayStart.getTime() - 30 * 24 * 60 * 60 * 1000),
        end: todayEnd
      };

    case DATE_RANGES.THIS_MONTH:
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1),
        end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
      };

    case DATE_RANGES.LAST_MONTH:
      return {
        start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
      };

    case DATE_RANGES.CUSTOM:
      return {
        start: customStart ? new Date(customStart) : todayStart,
        end: customEnd ? new Date(customEnd) : todayEnd
      };

    default:
      return { start: todayStart, end: todayEnd };
  }
};

/**
 * Formato legible del rango de fechas para mostrar en UI
 */
export const formatDateRangeLabel = (rangeType, customStart = null, customEnd = null) => {
  const now = new Date();
  const options = { day: 'numeric', month: 'short' };

  switch (rangeType) {
    case DATE_RANGES.TODAY:
      return `Hoy, ${now.toLocaleDateString('es-MX', { weekday: 'long' })}`;
    case DATE_RANGES.LAST_7_DAYS:
      return `Últimos 7 días`;
    case DATE_RANGES.LAST_30_DAYS:
      return `Últimos 30 días`;
    case DATE_RANGES.THIS_MONTH:
      return `Este mes (${now.toLocaleDateString('es-MX', { month: 'long' })})`;
    case DATE_RANGES.LAST_MONTH:
      return `Mes anterior`;
    case DATE_RANGES.CUSTOM:
      if (customStart && customEnd) {
        return `${new Date(customStart).toLocaleDateString('es-MX', options)} - ${new Date(customEnd).toLocaleDateString('es-MX', options)}`;
      }
      return 'Rango personalizado';
    default:
      return 'Hoy';
  }
};

// ============================================================
// 3. CAPA DE AGREGACIÓN POR AGENTE
// ============================================================

/**
 * Construye payload para el Auditor de Inventario
 * @param {Date} start - Fecha inicio
 * @param {Date} end - Fecha fin
 * @param {Array} menu - Menú completo (ya cargado en memoria)
 * @param {Array} wasteLogs - Mermas (ya cargadas en memoria)
 * @returns {Promise<Object>} - Payload agregado
 */
export const buildInventoryPayload = async (start, end, menu = [], wasteLogs = [], sales = []) => {
  // 1. Filtrar y detallar mermas
  const filteredWaste = wasteLogs.filter(w => {
    const wDate = new Date(w.timestamp);
    return wDate >= start && wDate <= end;
  });

  const wasteByCategory = new Map();
  const wasteByProduct = new Map();

  const totalWasteLoss = filteredWaste.reduce((sum, w) => {
    // Agrupación por categoría
    const category = w.category || 'General';
    const catCurrent = wasteByCategory.get(category) || { amount: 0, count: 0 };
    wasteByCategory.set(category, {
      amount: catCurrent.amount + (w.lossAmount || 0),
      count: catCurrent.count + 1
    });

    // Agrupación por producto (Nuevo - vital para el auditor)
    const productName = w.productName || 'Desconocido';
    const prodCurrent = wasteByProduct.get(productName) || { amount: 0, count: 0 };
    wasteByProduct.set(productName, {
      amount: prodCurrent.amount + (w.lossAmount || 0),
      count: prodCurrent.count + 1
    });

    return sum + (w.lossAmount || 0);
  }, 0);

  // 2. Filtrar ventas y rastrear qué se vendió realmente
  const filteredSales = sales.filter(s => {
    const sDate = new Date(s.timestamp);
    const isTestData = s.id?.includes('TEST_') || s.customerId === 'GENERIC' || s.items?.some(i => i.id?.includes('TEST_'));
    return sDate >= start && sDate <= end && !isTestData;
  });

  const topProducts = aggregateTopProducts(filteredSales, PAYLOAD_LIMITS.MAX_TOP_PRODUCTS);

  // Set de IDs de productos vendidos para detectar stock muerto real
  const soldProductIds = new Set();
  filteredSales.forEach(sale => {
    sale.items?.forEach(item => soldProductIds.add(item.parentId || item.id));
  });

  // 3. Análisis profundo del menú e inventario
  let totalInventoryValuation = 0;
  const lowStockProducts = [];
  const outOfStockProducts = [];
  const deadStockCandidates = [];

  menu.forEach(p => {
    if (!p.trackStock) return;

    // Calcular capital inmovilizado
    if (p.stock > 0) {
      totalInventoryValuation += p.stock * (p.cost || 0);
    }

    // Clasificación de stock
    if (p.stock === 0) {
      if (outOfStockProducts.length < PAYLOAD_LIMITS.MAX_TOP_PRODUCTS) {
        outOfStockProducts.push({ name: p.name, category: p.categoryName });
      }
    } else if (p.stock <= (p.minStock || 5)) { // Corrección: Usar minStock real
      if (lowStockProducts.length < PAYLOAD_LIMITS.MAX_TOP_PRODUCTS) {
        lowStockProducts.push({
          name: p.name,
          stock: p.stock,
          minStock: p.minStock || 5,
          category: p.categoryName
        });
      }
    }

    // Dead Stock Real: Tiene stock pero NO tuvo ventas en este rango de fechas
    if (p.stock > 0 && !soldProductIds.has(p.id)) {
      deadStockCandidates.push({
        name: p.name,
        stock: p.stock,
        tiedCapital: p.stock * (p.cost || 0) // Cuánto dinero te está costando este stock muerto
      });
    }
  });

  // Ordenar dead stock por impacto de capital
  const sortedDeadStock = deadStockCandidates
    .sort((a, b) => b.tiedCapital - a.tiedCapital)
    .slice(0, 5);

  const categoryStats = aggregateByCategory(menu);

  return {
    menuStats: {
      totalProducts: menu.length,
      productsWithStock: menu.filter(p => p.trackStock && p.stock > 0).length,
      totalInventoryValuation, // Nuevo: Capital atascado
      outOfStockCount: menu.filter(p => p.trackStock && p.stock === 0).length,
      categoriesCount: Object.keys(categoryStats).length
    },
    wasteStats: {
      totalWasteLoss,
      wasteTransactions: filteredWaste.length,
      topWasteCategories: Array.from(wasteByCategory.entries())
        .map(([category, data]) => ({ category, ...data }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5),
      topWastedProducts: Array.from(wasteByProduct.entries()) // Nuevo: Visibilidad granular
        .map(([product, data]) => ({ product, ...data }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5),
      avgWastePerTransaction: filteredWaste.length > 0 ? totalWasteLoss / filteredWaste.length : 0
    },
    inventoryAlerts: {
      outOfStockProducts, // Nuevo: Qué falta exactamente
      lowStockProducts,
      potentialDeadStock: sortedDeadStock // Nuevo: Basado en falta de ventas y capital inmovilizado
    },
    topProducts
  };
};

// ============================================================
// PAYLOAD: ANALISTA FINANCIERO
// ============================================================
export const buildFinancialPayload = async (start, end, sales = []) => {
  // Corrección: Filtrar ventas canceladas y datos de prueba
  const filteredSales = sales.filter(s => {
    const sDate = new Date(s.timestamp);
    const isTestData = s.id?.includes('TEST_') || s.customerId === 'GENERIC' || s.items?.some(i => i.id?.includes('TEST_'));
    const isCancelled = s.fulfillmentStatus === 'cancelled' || s.status === 'cancelled';
    return sDate >= start && sDate <= end && !isTestData && !isCancelled;
  });

  const financialSummary = summarizeFinancialSales(filteredSales);
  const totalRevenue = financialSummary.totalRevenue;
  const totalCost = financialSummary.confirmedCost;
  const totalDiscounts = financialSummary.totalDiscounts;
  const grossProfit = financialSummary.confirmedProfit;
  const grossMargin = financialSummary.confirmedMarginPct;

  const totalTransactions = filteredSales.length;
  const avgTicket = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;

  // Corrección: Evitar proyecciones irreales en rangos cortos
  const daysInRange = Math.max(1, (end - start) / (1000 * 60 * 60 * 24));
  const projectedMonthly = daysInRange >= 7 ? (totalRevenue / daysInRange) * 30 : null;

  return {
    salesStats: {
      totalRevenue,
      totalCost,          // Costo confirmado; costos faltantes no se asumen como 0
      grossProfit,        // Utilidad confirmada
      grossMarginPct: Number(grossMargin.toFixed(2)),
      confirmedRevenue: financialSummary.confirmedRevenue,
      missingCostRevenue: financialSummary.unconfirmedRevenue,
      unreliableProfitDueToMissingCosts: financialSummary.unreliableProfitDueToMissingCosts,
      missingCostRevenuePct: Number(financialSummary.missingCostRevenuePct.toFixed(2)),
      reportReliabilityPct: Number(financialSummary.reportReliabilityPct.toFixed(2)),
      financialQualityStatus: financialSummary.qualityStatus,
      hasMissingCosts: financialSummary.hasMissingCosts,
      shouldWarnFinancialQuality: financialSummary.shouldWarn,
      shouldBlockProfitAnalysis: financialSummary.shouldBlockProfitAnalysis,
      totalDiscounts,
      totalTransactions,
      avgTicket,
      projectedMonthly,   // Solo si el rango >= 7 días para ser estadísticamente válido
    },
    temporalPatterns: {
      revenueByDayOfWeek: aggregateByDayOfWeek(filteredSales),
      revenueByHour: aggregateByHour(filteredSales)
    },
    paymentAnalysis: aggregatePaymentMethods(filteredSales),
    orderTypeAnalysis: aggregateByOrderType(filteredSales),
    topProducts: aggregateTopProducts(filteredSales, PAYLOAD_LIMITS.MAX_TOP_PRODUCTS)
  };
};

// ============================================================
// PAYLOAD: ESTRATEGA DE CLIENTES
// ============================================================
export const buildCustomerPayload = async (start, end, customers = [], sales = []) => {
  const filteredSales = sales.filter(s => {
    const sDate = new Date(s.timestamp);
    const isTestData = s.id?.includes('TEST_') || s.customerId === 'GENERIC';
    const isCancelled = s.fulfillmentStatus === 'cancelled' || s.status === 'cancelled';
    return sDate >= start && sDate <= end && !isTestData && !isCancelled;
  });

  // Corrección: Separar ventas registradas de ventas de mostrador (walk-ins)
  let walkInTransactions = 0;
  let walkInRevenue = 0;
  let registeredRevenue = 0;

  const activeCustomerIds = new Set();

  filteredSales.forEach(s => {
    if (!s.customerId || s.customerId === 'MOSTRADOR') {
      walkInTransactions++;
      walkInRevenue += Number(s.total || 0);
    } else {
      activeCustomerIds.add(s.customerId);
      registeredRevenue += Number(s.total || 0);
    }
  });

  const activeCustomers = customers.filter(c => activeCustomerIds.has(c.id));
  const totalCustomers = customers.length;

  const totalDebt = customers.reduce((sum, c) => sum + Number(c.debt || 0), 0);
  const customersWithDebt = customers.filter(c => c.debt > 0);

  // Analizar qué compran los clientes registrados para perfilar
  const registeredCategoryPreferences = new Map();
  filteredSales.filter(s => s.customerId).forEach(sale => {
    sale.items?.forEach(item => {
      const cat = item.categoryName || 'General';
      registeredCategoryPreferences.set(cat, (registeredCategoryPreferences.get(cat) || 0) + 1);
    });
  });

  return {
    audienceSplit: { // Vital: Entender qué proporción del negocio está anonimizada
      totalTransactions: filteredSales.length,
      walkInTransactions,
      walkInRevenue,
      registeredTransactions: filteredSales.length - walkInTransactions,
      registeredRevenue,
    },
    customerBaseStats: {
      totalRegisteredCustomers: totalCustomers,
      activeThisPeriod: activeCustomers.length,
      engagementRate: totalCustomers > 0 ? (activeCustomers.length / totalCustomers) * 100 : 0,
      newCustomersThisPeriod: activeCustomers.filter(c => {
        const created = new Date(c.createdAt);
        return created >= start && created <= end;
      }).length
    },
    debtAnalysis: {
      totalDebt,
      debtorCount: customersWithDebt.length,
      topDebtors: customersWithDebt
        .sort((a, b) => (b.debt || 0) - (a.debt || 0))
        .slice(0, 5)
        .map(c => ({ name: c.name, debt: c.debt }))
    },
    loyaltyInsights: {
      topSpenders: aggregateCustomerSpending(filteredSales, customers),
      topCategoriesBoughtByRegistered: Array.from(registeredCategoryPreferences.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([category, count]) => ({ category, itemsBought: count })),
      // Ya no usas un hardcodeo estricto, le pasas las métricas dinámicas de recurrencia
      visitFrequency: calculateDynamicRecurrence(filteredSales)
    }
  };
};

// Corrección de la función de recurrencia para entregar datos crudos en lugar de etiquetas
const calculateDynamicRecurrence = (sales) => {
  const customerVisits = new Map();
  sales.forEach(sale => {
    if (!sale.customerId || sale.customerId === 'MOSTRADOR') return;
    customerVisits.set(sale.customerId, (customerVisits.get(sale.customerId) || 0) + 1);
  });

  const visits = Array.from(customerVisits.values());
  return {
    singleVisitCustomers: visits.filter(v => v === 1).length,
    twoToThreeVisits: visits.filter(v => v >= 2 && v <= 3).length,
    fourOrMoreVisits: visits.filter(v => v >= 4).length,
    avgVisitsPerActiveCustomer: visits.length > 0 ? visits.reduce((a, b) => a + b, 0) / visits.length : 0
  };
};

// ============================================================
// 4. FUNCIONES DE AGREGACIÓN AUXILIARES
// ============================================================

const aggregateTopProducts = (filteredSales, limit = 10) => {
  const productMap = new Map();

  filteredSales.forEach(sale => {
    sale.items?.forEach(item => {
      const id = item.parentId || item.id;
      const current = productMap.get(id) || {
        id,
        name: item.name,
        quantity: 0,
        revenue: 0
      };

      // Casteo estricto para evitar concatenaciones de texto
      const qty = Number(item.quantity || 0);
      const price = Number(item.price || 0);

      productMap.set(id, {
        ...current,
        quantity: current.quantity + qty,
        revenue: current.revenue + (price * qty)
      });
    });
  });

  return Array.from(productMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
};

const aggregateByCategory = (menu) => {
  const categories = new Map();
  menu.forEach(product => {
    const cat = product.categoryName || 'Sin categoría';
    const current = categories.get(cat) || { count: 0, withStock: 0 };
    categories.set(cat, {
      count: current.count + 1,
      withStock: current.withStock + (product.trackStock && product.stock > 0 ? 1 : 0)
    });
  });
  return Object.fromEntries(categories);
};

const aggregateByDayOfWeek = (sales) => {
  const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const stats = new Map(days.map(d => [d, { count: 0, revenue: 0 }]));

  sales.forEach(sale => {
    const day = days[new Date(sale.timestamp).getDay()];
    const current = stats.get(day) || { count: 0, revenue: 0 };
    stats.set(day, {
      count: current.count + 1,
      revenue: current.revenue + Number(sale.total || 0)
    });
  });

  return Object.fromEntries(stats);
};

const aggregateByHour = (sales) => {
  const hours = new Map();

  sales.forEach(sale => {
    const hour = new Date(sale.timestamp).getHours();
    const current = hours.get(hour) || { count: 0, revenue: 0 };
    hours.set(hour, {
      count: current.count + 1,
      revenue: current.revenue + Number(sale.total || 0)
    });
  });

  return Object.fromEntries(hours);
};

const aggregatePaymentMethods = (sales) => {
  const methods = new Map();
  const total = sales.length;

  sales.forEach(sale => {
    const method = sale.paymentMethod || 'No especificado';
    const current = methods.get(method) || { count: 0, revenue: 0 };
    methods.set(method, {
      count: current.count + 1,
      revenue: current.revenue + Number(sale.total || 0)
    });
  });

  return Array.from(methods.entries())
    .map(([method, data]) => ({
      method,
      count: data.count,
      revenue: data.revenue,
      percentage: total > 0 ? (data.count / total) * 100 : 0
    }))
    .sort((a, b) => b.count - a.count);
};

const aggregateByOrderType = (sales) => {
  const types = new Map();

  sales.forEach(sale => {
    const type = sale.orderType || 'Mostrador';
    const current = types.get(type) || { count: 0, revenue: 0 };
    types.set(type, {
      count: current.count + 1,
      revenue: current.revenue + Number(sale.total || 0)
    });
  });

  return Array.from(types.entries()).map(([type, data]) => ({
    type,
    count: data.count,
    avgTicket: data.count > 0 ? data.revenue / data.count : 0
  }));
};

const aggregateCustomerSpending = (sales, customers) => {
  const customerMap = new Map();

  sales.forEach(sale => {
    if (!sale.customerId) return;
    const current = customerMap.get(sale.customerId) || {
      customerId: sale.customerId,
      visits: 0,
      totalSpent: 0
    };
    customerMap.set(sale.customerId, {
      ...current,
      visits: current.visits + 1,
      totalSpent: current.totalSpent + Number(sale.total || 0)
    });
  });

  const customerData = customers.map(c => {
    const stats = customerMap.get(c.id) || { visits: 0, totalSpent: 0 };
    return {
      id: c.id,
      name: c.name,
      visits: stats.visits,
      totalSpent: stats.totalSpent,
      avgTicket: stats.visits > 0 ? stats.totalSpent / stats.visits : 0
    };
  });

  return customerData
    .filter(c => c.visits > 0)
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, 10);
};

export const calculateRecurrence = (sales, _customers) => {
  const customerVisits = new Map();

  sales.forEach(sale => {
    if (!sale.customerId) return;
    customerVisits.set(sale.customerId, (customerVisits.get(sale.customerId) || 0) + 1);
  });

  const visits = Array.from(customerVisits.values());
  const loyalCustomers = visits.filter(v => v >= 3).length;
  const oneTimeCustomers = visits.filter(v => v === 1).length;
  const totalActive = visits.length;

  return {
    recurrenceRate: totalActive > 0 ? (loyalCustomers / totalActive) * 100 : 0,
    avgVisits: totalActive > 0 ? visits.reduce((a, b) => a + b, 0) / totalActive : 0,
    oneTimeCustomers,
    loyalCustomers
  };
};

// ============================================================
// 5. FUNCIÓN PRINCIPAL EXPORTADA
// ============================================================

/**
 * Construye el payload completo para un agente específico
 * @param {string} agentType - Tipo de agente
 * @param {string} dateRangeType - Tipo de rango de fechas
 * @param {Object} options - Opciones adicionales (customStart, customEnd, data)
 * @returns {Promise<Object>} - Payload agregado listo para enviar a IA
 */
export const buildAgentPayload = async (agentType, dateRangeType, options = {}) => {
  const { start, end } = getDateRangeBounds(dateRangeType, options.customStart, options.customEnd);
  const dateRangeLabel = formatDateRangeLabel(dateRangeType, options.customStart, options.customEnd);

  // Datos opcionales pasados directamente (ya cargados en memoria)
  const { menu = [], wasteLogs = [], sales = [], customers = [] } = options;

  let payload = {
    dateRange: {
      type: dateRangeType,
      label: dateRangeLabel,
      start: start.toISOString(),
      end: end.toISOString()
    },
    generatedAt: new Date().toISOString()
  };

  switch (agentType) {
    case AGENT_TYPES.INVENTORY_AUDITOR:
      payload = {
        ...payload,
        ...(await buildInventoryPayload(start, end, menu, wasteLogs, sales))
      };
      break;

    case AGENT_TYPES.FINANCIAL_ANALYST:
      payload = {
        ...payload,
        ...(await buildFinancialPayload(start, end, sales))
      };
      break;

    case AGENT_TYPES.CUSTOMER_STRATEGIST:
      payload = {
        ...payload,
        ...(await buildCustomerPayload(start, end, customers, sales))
      };
      break;

    default:
      throw new Error(`Agente no reconocido: ${agentType}`);
  }

  return payload;
};

// Exportaciones
export {
  DATE_RANGES,
  AGENT_TYPES,
  PAYLOAD_LIMITS
};

export default {
  buildAgentPayload,
  getDateRangeBounds,
  formatDateRangeLabel,
  DATE_RANGES,
  AGENT_TYPES
};
