/**
 * agentToolRegistry
 *
 * Primera capa MCP-lite interna para los agentes de negocio.
 * No ejecuta acciones destructivas; solo calcula hallazgos estructurados
 * para que la IA razone con herramientas y no solo con un resumen plano.
 */

import { normalizeBusinessTypes as normalizeCanonicalBusinessTypes } from '../utils/businessType';

const TOOL_SEVERITY = {
  INFO: 'info',
  WARNING: 'warning',
  DANGER: 'danger',
  SUCCESS: 'success'
};

const normalizeBusinessTypes = (businessTypes = []) => {
  const canonicalTypes = normalizeCanonicalBusinessTypes(businessTypes, 'abarrotes');
  const detected = new Set();

  canonicalTypes.forEach(type => {
    if (type === 'food_service' || type === 'verduleria/fruteria') {
      detected.add('restaurant');
    } else if (type === 'farmacia') {
      detected.add('pharmacy');
    } else {
      detected.add('retail');
    }
  });

  return Array.from(detected);
};

const parseDateRange = (aggregatedPayload = {}) => {
  const start = aggregatedPayload?.dateRange?.start ? new Date(aggregatedPayload.dateRange.start) : null;
  const end = aggregatedPayload?.dateRange?.end ? new Date(aggregatedPayload.dateRange.end) : null;
  return { start, end };
};

const isWithinRange = (timestamp, start, end) => {
  if (!timestamp || !start || !end) return true;
  const date = new Date(timestamp);
  return date >= start && date <= end;
};

const filterValidSales = (sales = [], aggregatedPayload = {}) => {
  const { start, end } = parseDateRange(aggregatedPayload);

  return sales.filter(sale => {
    const isCancelled = sale.fulfillmentStatus === 'cancelled' || sale.status === 'cancelled';
    const isTestData = sale.id?.includes('TEST_') || sale.customerId === 'GENERIC' || sale.items?.some(item => item.id?.includes('TEST_'));
    return !isCancelled && !isTestData && isWithinRange(sale.timestamp || sale.date || sale.createdAt, start, end);
  });
};

const normalizeText = (value) => String(value || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

const classifyRestaurantItem = (item) => {
  const combined = `${normalizeText(item.name)} ${normalizeText(item.categoryName || item.category)}`;

  const foodKeywords = ['alita', 'boneless', 'hamburguesa', 'pizza', 'taco', 'platillo', 'orden', 'comida', 'pollo'];
  const drinkKeywords = ['refresco', 'bebida', 'agua', 'jugo', 'cafe', 'latte', 'frappe', 'frappé', 'soda'];
  const extraKeywords = ['papa', 'papas', 'aderezo', 'salsa', 'aros', 'nachos', 'extra', 'dip'];

  return {
    isFood: foodKeywords.some(keyword => combined.includes(keyword)),
    isDrink: drinkKeywords.some(keyword => combined.includes(keyword)),
    isExtra: extraKeywords.some(keyword => combined.includes(keyword))
  };
};

const sortObjectEntriesByValue = (obj = {}, valueKey = 'revenue') => {
  return Object.entries(obj)
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => Number(b[valueKey] || 0) - Number(a[valueKey] || 0));
};

const makeToolResult = ({ id, title, severity = TOOL_SEVERITY.INFO, summary, metrics = {}, actions = [], evidence = [], confidence = 0.75 }) => ({
  id,
  title,
  severity,
  summary,
  metrics,
  actions,
  evidence,
  confidence
});

const dataQualityTool = {
  id: 'common.dataQuality',
  name: 'Calidad de datos del negocio',
  description: 'Evalúa si el agente tiene datos suficientes para emitir recomendaciones confiables.',
  supportedAgents: ['inventoryAuditor', 'financialAnalyst', 'customerStrategist'],
  supportedBusinessTypes: ['restaurant', 'pharmacy', 'retail'],
  run: ({ rawData, aggregatedPayload }) => {
    const sales = filterValidSales(rawData.sales, aggregatedPayload);
    const menuCount = rawData.menu?.length || 0;
    const customersCount = rawData.customers?.length || 0;
    const wasteCount = rawData.wasteLogs?.length || 0;

    const warnings = [];
    if (sales.length < 5) warnings.push('Pocas ventas en el período; las recomendaciones deben tratarse como preliminares.');
    if (menuCount === 0) warnings.push('No hay productos cargados para cruzar ventas contra inventario.');
    if (customersCount === 0) warnings.push('No hay clientes registrados; la lectura de fidelización será limitada.');

    return makeToolResult({
      id: dataQualityTool.id,
      title: 'Calidad de datos',
      severity: warnings.length > 0 ? TOOL_SEVERITY.WARNING : TOOL_SEVERITY.SUCCESS,
      summary: warnings.length > 0
        ? `El análisis tiene ${warnings.length} advertencia(s) de calidad de datos.`
        : 'Los datos mínimos para el análisis están disponibles.',
      metrics: {
        salesInRange: sales.length,
        menuProducts: menuCount,
        registeredCustomers: customersCount,
        wasteRecords: wasteCount
      },
      actions: warnings,
      confidence: warnings.length > 0 ? 0.65 : 0.9
    });
  }
};

const inventoryStockRiskTool = {
  id: 'inventory.stockRisk',
  name: 'Riesgo de inventario',
  description: 'Detecta productos agotados, bajo stock y capital posiblemente detenido.',
  supportedAgents: ['inventoryAuditor'],
  supportedBusinessTypes: ['restaurant', 'pharmacy', 'retail'],
  run: ({ aggregatedPayload }) => {
    const alerts = aggregatedPayload.inventoryAlerts || {};
    const outOfStock = alerts.outOfStockProducts || [];
    const lowStock = alerts.lowStockProducts || [];
    const deadStock = alerts.potentialDeadStock || [];
    const tiedCapital = deadStock.reduce((sum, product) => sum + Number(product.tiedCapital || 0), 0);

    const severity = outOfStock.length > 0 || tiedCapital > 1000
      ? TOOL_SEVERITY.DANGER
      : lowStock.length > 0 || deadStock.length > 0
        ? TOOL_SEVERITY.WARNING
        : TOOL_SEVERITY.SUCCESS;

    return makeToolResult({
      id: inventoryStockRiskTool.id,
      title: 'Riesgo de inventario',
      severity,
      summary: `${outOfStock.length} agotados, ${lowStock.length} en bajo stock y ${deadStock.length} candidatos a stock muerto.`,
      metrics: {
        outOfStockCount: outOfStock.length,
        lowStockCount: lowStock.length,
        deadStockCandidates: deadStock.length,
        tiedCapital
      },
      actions: [
        outOfStock.length > 0 ? 'Prioriza reposición o desactiva temporalmente productos agotados del menú.' : null,
        lowStock.length > 0 ? 'Programa reposición de productos bajo mínimo antes del siguiente pico de venta.' : null,
        deadStock.length > 0 ? 'Considera promoción, combo o liquidación para liberar capital detenido.' : null
      ].filter(Boolean),
      evidence: [
        ...outOfStock.slice(0, 3).map(product => `Agotado: ${product.name}`),
        ...lowStock.slice(0, 3).map(product => `Bajo stock: ${product.name} (${product.stock}/${product.minStock})`),
        ...deadStock.slice(0, 3).map(product => `Stock muerto: ${product.name} - $${Number(product.tiedCapital || 0).toFixed(2)}`)
      ],
      confidence: 0.86
    });
  }
};

const wasteImpactTool = {
  id: 'operations.wasteImpact',
  name: 'Impacto de mermas',
  description: 'Resume pérdidas por merma y productos/categorías que más afectan.',
  supportedAgents: ['inventoryAuditor', 'financialAnalyst'],
  supportedBusinessTypes: ['restaurant', 'retail'],
  run: ({ aggregatedPayload }) => {
    const waste = aggregatedPayload.wasteStats || {};
    const totalWasteLoss = Number(waste.totalWasteLoss || 0);
    const topWasteCategories = waste.topWasteCategories || [];
    const topWastedProducts = waste.topWastedProducts || [];

    return makeToolResult({
      id: wasteImpactTool.id,
      title: 'Impacto de mermas',
      severity: totalWasteLoss > 0 ? TOOL_SEVERITY.WARNING : TOOL_SEVERITY.SUCCESS,
      summary: totalWasteLoss > 0
        ? `Se detectaron $${totalWasteLoss.toFixed(2)} en mermas durante el período.`
        : 'No se detectaron mermas registradas en el período.',
      metrics: {
        totalWasteLoss,
        wasteTransactions: waste.wasteTransactions || 0,
        avgWastePerTransaction: waste.avgWastePerTransaction || 0
      },
      actions: totalWasteLoss > 0
        ? ['Revisar porcionamiento, caducidades y manipulación de los productos con mayor merma.']
        : ['Mantener registro de mermas para detectar patrones futuros.'],
      evidence: [
        ...topWasteCategories.slice(0, 3).map(item => `Categoría: ${item.category} - $${Number(item.amount || 0).toFixed(2)}`),
        ...topWastedProducts.slice(0, 3).map(item => `Producto: ${item.product} - $${Number(item.amount || 0).toFixed(2)}`)
      ],
      confidence: totalWasteLoss > 0 ? 0.82 : 0.7
    });
  }
};

const salesPulseTool = {
  id: 'finance.salesPulse',
  name: 'Pulso financiero',
  description: 'Calcula salud básica de ventas, utilidad, margen y ticket promedio.',
  supportedAgents: ['financialAnalyst'],
  supportedBusinessTypes: ['restaurant', 'pharmacy', 'retail'],
  run: ({ aggregatedPayload }) => {
    const stats = aggregatedPayload.salesStats || {};
    const grossMarginPct = Number(stats.grossMarginPct || 0);

    return makeToolResult({
      id: salesPulseTool.id,
      title: 'Pulso financiero',
      severity: grossMarginPct > 25 ? TOOL_SEVERITY.SUCCESS : grossMarginPct > 10 ? TOOL_SEVERITY.WARNING : TOOL_SEVERITY.DANGER,
      summary: `Ingreso $${Number(stats.totalRevenue || 0).toFixed(2)}, utilidad bruta $${Number(stats.grossProfit || 0).toFixed(2)} y margen ${grossMarginPct.toFixed(1)}%.`,
      metrics: {
        totalRevenue: stats.totalRevenue || 0,
        grossProfit: stats.grossProfit || 0,
        grossMarginPct,
        avgTicket: stats.avgTicket || 0,
        totalTransactions: stats.totalTransactions || 0,
        projectedMonthly: stats.projectedMonthly
      },
      actions: [
        grossMarginPct < 20 ? 'Revisar precios/costos de los productos principales porque el margen está bajo.' : null,
        Number(stats.avgTicket || 0) > 0 ? 'Usar ticket promedio como base para diseñar combos y metas por turno.' : null
      ].filter(Boolean),
      confidence: 0.88
    });
  }
};

const temporalHotspotsTool = {
  id: 'finance.temporalHotspots',
  name: 'Horarios y días fuertes',
  description: 'Identifica días y horas con mayor ingreso para orientar operación y promociones.',
  supportedAgents: ['financialAnalyst'],
  supportedBusinessTypes: ['restaurant', 'pharmacy', 'retail'],
  run: ({ aggregatedPayload }) => {
    const patterns = aggregatedPayload.temporalPatterns || {};
    const topDays = sortObjectEntriesByValue(patterns.revenueByDayOfWeek || {}, 'revenue').slice(0, 3);
    const topHours = sortObjectEntriesByValue(patterns.revenueByHour || {}, 'revenue').slice(0, 3);

    return makeToolResult({
      id: temporalHotspotsTool.id,
      title: 'Horarios y días fuertes',
      severity: topDays.length > 0 || topHours.length > 0 ? TOOL_SEVERITY.INFO : TOOL_SEVERITY.WARNING,
      summary: topDays.length > 0
        ? `Día más fuerte: ${topDays[0].key}. Hora más fuerte: ${topHours[0]?.key ?? 'sin datos'}:00.`
        : 'No hay suficiente patrón temporal para detectar horarios fuertes.',
      metrics: {
        topDay: topDays[0]?.key || null,
        topDayRevenue: topDays[0]?.revenue || 0,
        topHour: topHours[0]?.key || null,
        topHourRevenue: topHours[0]?.revenue || 0
      },
      actions: [
        topHours.length > 0 ? 'Preparar inventario y personal antes de las horas con mayor ingreso.' : null,
        topDays.length > 0 ? 'Usar los días débiles para promociones y los días fuertes para combos de mayor margen.' : null
      ].filter(Boolean),
      evidence: [
        ...topDays.map(day => `Día: ${day.key} - $${Number(day.revenue || 0).toFixed(2)}`),
        ...topHours.map(hour => `Hora: ${hour.key}:00 - $${Number(hour.revenue || 0).toFixed(2)}`)
      ],
      confidence: topDays.length > 0 ? 0.8 : 0.55
    });
  }
};

const restaurantUpsellTool = {
  id: 'restaurant.upsellLeakage',
  name: 'Fuga de extras y bebidas',
  description: 'Detecta tickets con comida sin bebidas ni extras para proponer combos.',
  supportedAgents: ['financialAnalyst', 'customerStrategist'],
  supportedBusinessTypes: ['restaurant'],
  run: ({ rawData, aggregatedPayload }) => {
    const sales = filterValidSales(rawData.sales, aggregatedPayload);
    let foodTickets = 0;
    let leakedTickets = 0;
    let ticketsWithExtras = 0;

    sales.forEach(sale => {
      const items = sale.items || [];
      const hasFood = items.some(item => classifyRestaurantItem(item).isFood);
      const hasDrink = items.some(item => classifyRestaurantItem(item).isDrink);
      const hasExtra = items.some(item => classifyRestaurantItem(item).isExtra);

      if (hasFood) {
        foodTickets++;
        if (hasDrink || hasExtra) ticketsWithExtras++;
        if (!hasDrink && !hasExtra) leakedTickets++;
      }
    });

    const leakageRate = foodTickets > 0 ? leakedTickets / foodTickets : 0;

    return makeToolResult({
      id: restaurantUpsellTool.id,
      title: 'Fuga de extras y bebidas',
      severity: leakageRate > 0.5 ? TOOL_SEVERITY.DANGER : leakageRate > 0.25 ? TOOL_SEVERITY.WARNING : TOOL_SEVERITY.SUCCESS,
      summary: `${leakedTickets} de ${foodTickets} tickets con comida no incluyeron bebida ni extra.`,
      metrics: {
        foodTickets,
        leakedTickets,
        ticketsWithExtras,
        leakageRatePct: leakageRate * 100
      },
      actions: leakedTickets > 0
        ? ['Crear combo sugerido con bebida/extra y mostrarlo antes de cerrar cada venta.', 'Medir si sube el ticket promedio durante 7 días.']
        : ['Mantener la estrategia actual de extras porque no se detecta fuga relevante.'],
      confidence: foodTickets >= 10 ? 0.84 : 0.6
    });
  }
};

const customerHealthTool = {
  id: 'customer.customerHealth',
  name: 'Salud de clientes',
  description: 'Evalúa recurrencia, clientes activos, ticket registrado y deuda.',
  supportedAgents: ['customerStrategist'],
  supportedBusinessTypes: ['restaurant', 'pharmacy', 'retail'],
  run: ({ aggregatedPayload }) => {
    const base = aggregatedPayload.customerBaseStats || {};
    const debt = aggregatedPayload.debtAnalysis || {};
    const split = aggregatedPayload.audienceSplit || {};
    const recurrence = aggregatedPayload.loyaltyInsights?.visitFrequency || {};
    const engagementRate = Number(base.engagementRate || 0);

    return makeToolResult({
      id: customerHealthTool.id,
      title: 'Salud de clientes',
      severity: Number(debt.totalDebt || 0) > 0 || engagementRate < 15 ? TOOL_SEVERITY.WARNING : TOOL_SEVERITY.SUCCESS,
      summary: `${base.activeThisPeriod || 0} clientes activos de ${base.totalRegisteredCustomers || 0} registrados. Engagement ${engagementRate.toFixed(1)}%.`,
      metrics: {
        totalRegisteredCustomers: base.totalRegisteredCustomers || 0,
        activeThisPeriod: base.activeThisPeriod || 0,
        engagementRate,
        totalDebt: debt.totalDebt || 0,
        debtorCount: debt.debtorCount || 0,
        walkInTransactions: split.walkInTransactions || 0,
        registeredTransactions: split.registeredTransactions || 0,
        singleVisitCustomers: recurrence.singleVisitCustomers || 0,
        fourOrMoreVisits: recurrence.fourOrMoreVisits || 0
      },
      actions: [
        engagementRate < 15 ? 'Impulsar registro de clientes en mostrador/caja con beneficio simple.' : null,
        Number(debt.totalDebt || 0) > 0 ? 'Preparar seguimiento de cobranza para clientes con deuda alta.' : null,
        Number(recurrence.singleVisitCustomers || 0) > 0 ? 'Diseñar mensaje de segunda visita para clientes que solo compraron una vez.' : null
      ].filter(Boolean),
      evidence: (debt.topDebtors || []).slice(0, 3).map(customer => `Deudor: ${customer.name} - $${Number(customer.debt || 0).toFixed(2)}`),
      confidence: 0.82
    });
  }
};

const retailMarginRiskTool = {
  id: 'retail.marginRisk',
  name: 'Riesgo de margen por producto',
  description: 'Detecta productos con margen bajo a partir del menú actual.',
  supportedAgents: ['financialAnalyst', 'inventoryAuditor'],
  supportedBusinessTypes: ['retail', 'pharmacy', 'restaurant'],
  run: ({ rawData }) => {
    const products = rawData.menu || [];
    const lowMarginProducts = products
      .map(product => {
        const price = Number(product.price || 0);
        const cost = Number(product.cost || 0);
        if (price <= 0 || cost <= 0) return null;

        const marginPct = ((price - cost) / price) * 100;
        return {
          name: product.name,
          price,
          cost,
          marginPct,
          profitPerUnit: price - cost
        };
      })
      .filter(Boolean)
      .filter(product => product.marginPct < 20)
      .sort((a, b) => a.marginPct - b.marginPct)
      .slice(0, 8);

    return makeToolResult({
      id: retailMarginRiskTool.id,
      title: 'Riesgo de margen por producto',
      severity: lowMarginProducts.length > 0 ? TOOL_SEVERITY.WARNING : TOOL_SEVERITY.SUCCESS,
      summary: lowMarginProducts.length > 0
        ? `${lowMarginProducts.length} producto(s) tienen margen menor al 20%.`
        : 'No se detectaron márgenes bajos con los costos disponibles.',
      metrics: {
        lowMarginProducts: lowMarginProducts.length
      },
      actions: lowMarginProducts.length > 0
        ? ['Revisar precio/costo de los productos con margen menor al 20%.']
        : ['Mantener costos actualizados para que el agente pueda detectar aumentos.'],
      evidence: lowMarginProducts.map(product => `${product.name}: margen ${product.marginPct.toFixed(1)}%, utilidad $${product.profitPerUnit.toFixed(2)}`),
      confidence: lowMarginProducts.length > 0 ? 0.78 : 0.62
    });
  }
};

export const AGENT_TOOL_REGISTRY = [
  dataQualityTool,
  inventoryStockRiskTool,
  wasteImpactTool,
  salesPulseTool,
  temporalHotspotsTool,
  restaurantUpsellTool,
  customerHealthTool,
  retailMarginRiskTool
];

export const getAvailableAgentTools = ({ agentType, businessTypes = [] } = {}) => {
  const normalizedBusinessTypes = normalizeBusinessTypes(businessTypes);

  return AGENT_TOOL_REGISTRY.filter(tool => {
    const supportsAgent = !tool.supportedAgents || tool.supportedAgents.includes(agentType);
    const supportsBusiness = !tool.supportedBusinessTypes
      || tool.supportedBusinessTypes.some(type => normalizedBusinessTypes.includes(type));

    return supportsAgent && supportsBusiness;
  });
};

export const runAgentTools = async ({ agentType, businessTypes = [], rawData = {}, aggregatedPayload = {} } = {}) => {
  const tools = getAvailableAgentTools({ agentType, businessTypes });
  const results = [];

  for (const tool of tools) {
    try {
      const result = await tool.run({ agentType, businessTypes, rawData, aggregatedPayload });
      if (result) results.push(result);
    } catch (error) {
      results.push(makeToolResult({
        id: tool.id,
        title: tool.name,
        severity: TOOL_SEVERITY.WARNING,
        summary: `La herramienta no pudo ejecutarse: ${error.message || 'error desconocido'}`,
        metrics: {},
        actions: ['Revisar la estructura de datos local para esta herramienta.'],
        confidence: 0.3
      }));
    }
  }

  return {
    executedAt: new Date().toISOString(),
    availableToolCount: tools.length,
    results
  };
};

export default {
  AGENT_TOOL_REGISTRY,
  getAvailableAgentTools,
  runAgentTools
};
