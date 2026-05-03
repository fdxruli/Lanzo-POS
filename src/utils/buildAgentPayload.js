/**
 * Build Agent Payload - Capa de agregación de datos para agentes de IA
 * 
 * Simula extraer datos de IndexedDB y devuelve un JSON estrictamente resumido
 * (sumar totales, listar top items, NO datos crudos completos)
 */

import { db, STORES } from '../services/db/dexie';

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
export const buildInventoryPayload = async (start, end, menu = [], wasteLogs = []) => {
  // Filtrar mermas en el rango
  const filteredWaste = wasteLogs.filter(w => {
    const wDate = new Date(w.timestamp);
    return wDate >= start && wDate <= end;
  });

  // Agregar mermas
  const wasteByCategory = new Map();
  const totalWasteLoss = filteredWaste.reduce((sum, w) => {
    const category = w.category || 'General';
    const current = wasteByCategory.get(category) || { amount: 0, count: 0 };
    wasteByCategory.set(category, {
      amount: current.amount + (w.lossAmount || 0),
      count: current.count + 1
    });
    return sum + (w.lossAmount || 0);
  }, 0);

  // Productos con stock bajo (simulado desde menú)
  const lowStockProducts = menu
    .filter(p => p.trackStock && p.stock > 0 && p.stock <= 5)
    .slice(0, PAYLOAD_LIMITS.MAX_TOP_PRODUCTS)
    .map(p => ({
      name: p.name,
      stock: p.stock,
      category: p.categoryName
    }));

  // Productos sin stock
  const outOfStockCount = menu.filter(p => p.trackStock && p.stock === 0).length;

  // Top productos más vendidos (agregado de ventas)
  const topProducts = await aggregateTopProducts(start, end, PAYLOAD_LIMITS.MAX_TOP_PRODUCTS);

  // Productos por categoría
  const categoryStats = aggregateByCategory(menu);

  return {
    menuStats: {
      totalProducts: menu.length,
      productsWithStock: menu.filter(p => p.trackStock && p.stock > 0).length,
      outOfStockCount,
      lowStockCount: lowStockProducts.length,
      categoriesCount: Object.keys(categoryStats).length
    },
    wasteStats: {
      totalWasteLoss,
      wasteTransactions: filteredWaste.length,
      topWasteCategories: Array.from(wasteByCategory.entries())
        .map(([category, data]) => ({ category, ...data }))
        .slice(0, 5),
      avgWastePerTransaction: filteredWaste.length > 0
        ? totalWasteLoss / filteredWaste.length
        : 0
    },
    inventoryAlerts: {
      lowStockProducts,
      potentialDeadStock: menu
        .filter(p => p.trackStock && p.stock > 10 && !topProducts.find(tp => tp.name === p.name))
        .slice(0, 5)
        .map(p => ({ name: p.name, stock: p.stock }))
    },
    topProducts
  };
};

/**
 * Construye payload para el Analista Financiero
 */
export const buildFinancialPayload = async (start, end, sales = []) => {
  // Filtrar ventas en rango
  const filteredSales = sales.filter(s => {
    const sDate = new Date(s.timestamp);
    return sDate >= start && sDate <= end;
  });

  // Métricas básicas
  const totalRevenue = filteredSales.reduce((sum, s) => sum + (s.total || 0), 0);
  const totalTransactions = filteredSales.length;
  const avgTicket = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;

  // Agrupar por día de la semana
  const revenueByDayOfWeek = aggregateByDayOfWeek(filteredSales);

  // Agrupar por hora del día (para detectar picos)
  const revenueByHour = aggregateByHour(filteredSales);

  // Métodos de pago
  const paymentMethods = aggregatePaymentMethods(filteredSales);

  // Ticket promedio por tipo de orden
  const ticketByOrderType = aggregateByOrderType(filteredSales);

  // Proyección mensual
  const daysInRange = Math.max(1, (end - start) / (1000 * 60 * 60 * 24));
  const projectedMonthly = (totalRevenue / daysInRange) * 30;

  return {
    salesStats: {
      totalRevenue,
      totalTransactions,
      avgTicket,
      projectedMonthly,
      uniqueTickets: new Set(filteredSales.map(s => s.id)).size
    },
    temporalPatterns: {
      revenueByDayOfWeek,
      peakHours: Object.entries(revenueByHour)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([hour, revenue]) => ({ hour: `${hour}:00`, revenue })),
      lowHours: Object.entries(revenueByHour)
        .sort(([, a], [, b]) => a - b)
        .slice(0, 2)
        .map(([hour, revenue]) => ({ hour: `${hour}:00`, revenue }))
    },
    paymentAnalysis: {
      methods: paymentMethods,
      mostUsedMethod: paymentMethods.length > 0 ? paymentMethods[0].method : 'N/A',
      cashPercentage: paymentMethods.find(m => m.method === 'Efectivo')?.percentage || 0
    },
    orderTypeAnalysis: ticketByOrderType,
    topProducts: await aggregateTopProducts(start, end, PAYLOAD_LIMITS.MAX_TOP_PRODUCTS)
  };
};

/**
 * Construye payload para el Estratega de Clientes
 */
export const buildCustomerPayload = async (start, end, customers = [], sales = []) => {
  // Filtrar ventas en rango
  const filteredSales = sales.filter(s => {
    const sDate = new Date(s.timestamp);
    return sDate >= start && sDate <= end;
  });

  // Clientes activos en el período
  const activeCustomerIds = new Set(filteredSales.map(s => s.customerId).filter(Boolean));
  const activeCustomers = customers.filter(c => activeCustomerIds.has(c.id));

  // Métricas de clientes
  const totalCustomers = customers.length;
  const activeCustomersCount = activeCustomers.length;
  const activeRate = totalCustomers > 0 ? (activeCustomersCount / totalCustomers) * 100 : 0;

  // Deuda total
  const totalDebt = customers.reduce((sum, c) => sum + (c.debt || 0), 0);
  const customersWithDebt = customers.filter(c => c.debt > 0);

  // Top clientes por gasto
  const customerSpending = aggregateCustomerSpending(filteredSales, customers);

  // Recurrencia
  const recurrenceStats = calculateRecurrence(filteredSales, customers);

  // Ticket promedio por cliente
  const avgTicketPerCustomer = activeCustomersCount > 0
    ? filteredSales.reduce((sum, s) => sum + (s.total || 0), 0) / activeCustomersCount
    : 0;

  return {
    customerStats: {
      totalCustomers,
      activeCustomers: activeCustomersCount,
      activeRate,
      avgTicketPerCustomer,
      newCustomersThisPeriod: activeCustomers.filter(c => {
        const created = new Date(c.createdAt);
        return created >= start && created <= end;
      }).length
    },
    debtAnalysis: {
      totalDebt,
      customersWithDebt: customersWithDebt.length,
      avgDebt: customersWithDebt.length > 0 ? totalDebt / customersWithDebt.length : 0,
      topDebtors: customersWithDebt
        .sort((a, b) => (b.debt || 0) - (a.debt || 0))
        .slice(0, PAYLOAD_LIMITS.MAX_TOP_CUSTOMERS)
        .map(c => ({ name: c.name, debt: c.debt, phone: c.phone }))
    },
    loyaltyInsights: {
      topCustomers: customerSpending,
      recurrenceRate: recurrenceStats.recurrenceRate,
      avgVisitsPerCustomer: recurrenceStats.avgVisits,
      oneTimeCustomers: recurrenceStats.oneTimeCustomers,
      loyalCustomers: recurrenceStats.loyalCustomers
    }
  };
};

// ============================================================
// 4. FUNCIONES DE AGREGACIÓN AUXILIARES
// ============================================================

const aggregateTopProducts = async (start, end, limit = 10) => {
  try {
    const sales = await db.sales
      .where('timestamp')
      .between(start.getTime(), end.getTime())
      .toArray();

    const productMap = new Map();

    sales.forEach(sale => {
      sale.items?.forEach(item => {
        const id = item.parentId || item.id;
        const current = productMap.get(id) || {
          id,
          name: item.name,
          quantity: 0,
          revenue: 0
        };
        productMap.set(id, {
          ...current,
          quantity: current.quantity + (item.quantity || 0),
          revenue: current.revenue + ((item.price || 0) * (item.quantity || 0))
        });
      });
    });

    return Array.from(productMap.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit);
  } catch (error) {
    console.error('Error aggregating top products:', error);
    return [];
  }
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
      revenue: current.revenue + (sale.total || 0)
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
      revenue: current.revenue + (sale.total || 0)
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
      revenue: current.revenue + (sale.total || 0)
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
      revenue: current.revenue + (sale.total || 0)
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
      totalSpent: current.totalSpent + (sale.total || 0)
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

const calculateRecurrence = (sales, customers) => {
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
        ...(await buildInventoryPayload(start, end, menu, wasteLogs))
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
