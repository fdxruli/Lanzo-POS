/**
 * AI Prompt Builder - Generador de prompts estructurados para agentes de IA
 *
 * Construye prompts del sistema que inyectan contexto del negocio y exigen
 * respuestas en formato Markdown con viñetas, sin saludos y con pasos accionables.
 */

// ============================================================
// 1. PLANTILLAS DE PROMPTS POR AGENTE
// ============================================================

const AGENT_PROMPTS = {
  inventoryAuditor: {
    role: 'Auditor de Inventario',
    systemPrompt: `Eres un auditor de inventario experto para retail y restaurantes. Analizas datos de mermas, rotación de productos y niveles de stock.

REGLAS DE RESPUESTA:
- NO uses saludos ni introducciones
- Responde ÚNICAMENTE en formato Markdown con viñetas
- Sé directo y accionable
- Usa tono profesional pero accesible
- Prioriza recomendaciones por impacto económico

ESTRUCTURA OBLIGATORIA:
1. 📊 Hallazgos Principales (máximo 5 puntos)
2. ⚠️ Alertas Críticas (si aplican)
3. 💡 Recomendaciones Accionables (mínimo 3, máximo 7)
4. 📈 Oportunidades de Mejora (máximo 3)`,

    contextInjection: `
CONTEXTO DEL NEGOCIO:
- Tipo de negocio: {businessType}
- Período analizado: {dateRange}
- Total productos en menú: {totalProducts}
- Productos con stock activo: {productsWithStock}

DATOS AGREGADOS:
{aggregatedData}`
  },

  financialAnalyst: {
    role: 'Analista Financiero',
    systemPrompt: `Eres un analista financiero especializado en PYMEs de retail y servicios. Analizas ticket promedio, patrones de venta temporal y métodos de pago.

REGLAS DE RESPUESTA:
- NO uses saludos ni introducciones
- Responde ÚNICAMENTE en formato Markdown con viñetas
- Sé directo y accionable
- Usa tono profesional pero accesible
- Prioriza recomendaciones por ROI potencial

ESTRUCTURA OBLIGATORIA:
1. 📊 Métricas Clave del Período (máximo 6 puntos)
2. 📈 Patrones Detectados (temporalidad, pagos)
3. 💰 Oportunidades de Ingreso (mínimo 3, máximo 5)
4. 🎯 Acciones Inmediatas (máximo 3)`,

    contextInjection: `
CONTEXTO DEL NEGOCIO:
- Tipo de negocio: {businessType}
- Período analizado: {dateRange}
- Total ventas procesadas: {totalSales}
- Tickets únicos: {uniqueTickets}

DATOS AGREGADOS:
{aggregatedData}`
  },

  customerStrategist: {
    role: 'Estratega de Clientes',
    systemPrompt: `Eres un estratega de clientes experto en retención y fidelización para comercios locales. Analizas recurrencia, deuda de clientes y ticket promedio por cliente.

REGLAS DE RESPUESTA:
- NO uses saludos ni introducciones
- Responde ÚNICAMENTE en formato Markdown con viñetas
- Sé directo y accionable
- Usa tono profesional pero accesible
- Prioriza recomendaciones por impacto en retención

ESTRUCTURA OBLIGATORIA:
1. 📊 Perfil de Clientes (máximo 5 puntos)
2. ⚠️ Situación de Deuda (si aplica)
3. 🎯 Estrategias de Fidelización (mínimo 3, máximo 6)
4. 📋 Acciones de Cobro/Recuperación (si aplica)`,

    contextInjection: `
CONTEXTO DEL NEGOCIO:
- Tipo de negocio: {businessType}
- Período analizado: {dateRange}
- Total clientes en base: {totalCustomers}
- Clientes activos en período: {activeCustomers}

DATOS AGREGADOS:
{aggregatedData}`
  }
};

// ============================================================
// 2. FORMATO DE DATOS AGREGADOS
// ============================================================

const formatKeyToTitle = (key) => String(key)
  .replace(/([A-Z])/g, ' $1')
  .replace(/^./, str => str.toUpperCase())
  .replace(/\b\w/g, str => str.toUpperCase());

const shouldFormatAsPercent = (key = '') => {
  const normalized = key.toLowerCase();
  return normalized.includes('pct') || normalized.includes('percent') || normalized.includes('rate') || normalized.includes('ratio');
};

const shouldFormatAsCurrency = (key = '') => {
  const normalized = key.toLowerCase();
  return normalized.includes('revenue')
    || normalized.includes('cost')
    || normalized.includes('profit')
    || normalized.includes('amount')
    || normalized.includes('debt')
    || normalized.includes('loss')
    || normalized.includes('capital')
    || normalized.includes('ticket')
    || normalized.includes('spent')
    || normalized.includes('discount');
};

const formatValue = (value, key = '') => {
  if (typeof value === 'number') {
    if (shouldFormatAsPercent(key)) {
      const percentage = value > 0 && value <= 1 ? value * 100 : value;
      return `${percentage.toFixed(1)}%`;
    }

    if (shouldFormatAsCurrency(key)) {
      return `$${value.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    return value.toLocaleString('es-MX', { maximumFractionDigits: 2 });
  }

  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (value instanceof Date) return value.toLocaleDateString('es-MX');
  if (value === null || value === undefined) return 'N/A';

  return String(value);
};

const formatNestedObject = (value, depth = 0) => {
  if (!value || typeof value !== 'object') return formatValue(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return 'Sin registros';

    return value.slice(0, 10).map((item, idx) => {
      if (item && typeof item === 'object') {
        const itemStr = Object.entries(item)
          .map(([k, v]) => `${formatKeyToTitle(k)}: ${formatValue(v, k)}`)
          .join(', ');
        return `${idx + 1}. ${itemStr}`;
      }
      return `${idx + 1}. ${formatValue(item)}`;
    }).join('\n');
  }

  return Object.entries(value)
    .map(([k, v]) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        return `${'  '.repeat(depth)}• ${formatKeyToTitle(k)}:\n${formatNestedObject(v, depth + 1)}`;
      }
      if (Array.isArray(v)) {
        return `${'  '.repeat(depth)}• ${formatKeyToTitle(k)}:\n${formatNestedObject(v, depth + 1)}`;
      }
      return `${'  '.repeat(depth)}• ${formatKeyToTitle(k)}: ${formatValue(v, k)}`;
    })
    .join('\n');
};

const formatAggregatedData = (data) => {
  if (!data || typeof data !== 'object') return 'Sin datos disponibles';

  return Object.entries(data)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        if (value.length === 0) return null;
        return `\n${formatKeyToTitle(key)}:\n${formatNestedObject(value)}`;
      }

      if (typeof value === 'object') {
        return `\n${formatKeyToTitle(key)}:\n${formatNestedObject(value)}`;
      }

      return `${formatKeyToTitle(key)}: ${formatValue(value, key)}`;
    })
    .filter(Boolean)
    .join('\n');
};

// ============================================================
// 3. CONSTRUCTOR DE PROMPT FINAL
// ============================================================

const aggregateContextFields = (agentType, aggregatedData, businessContext) => {
  const context = {};

  switch (agentType) {
    case 'inventoryAuditor':
      context.totalProducts = aggregatedData?.menuStats?.totalProducts || 0;
      context.productsWithStock = aggregatedData?.menuStats?.productsWithStock || 0;
      break;

    case 'financialAnalyst':
      context.totalSales = aggregatedData?.salesStats?.totalTransactions || 0;
      context.uniqueTickets = aggregatedData?.salesStats?.totalTransactions || 0;
      break;

    case 'customerStrategist':
      context.totalCustomers = businessContext.totalCustomers || aggregatedData?.customerBaseStats?.totalRegisteredCustomers || 0;
      context.activeCustomers = aggregatedData?.customerBaseStats?.activeThisPeriod || 0;
      break;

    default:
      break;
  }

  return context;
};

export const buildPrompt = (agentType, aggregatedData, businessContext = {}) => {
  const agentConfig = AGENT_PROMPTS[agentType];

  if (!agentConfig) {
    throw new Error(`Agente no reconocido: ${agentType}`);
  }

  const contextData = {
    businessType: businessContext.businessType || 'No especificado',
    dateRange: businessContext.dateRange || 'No especificado',
    ...aggregateContextFields(agentType, aggregatedData, businessContext)
  };

  const contextInjection = agentConfig.contextInjection
    .replace(/{businessType}/g, contextData.businessType)
    .replace(/{dateRange}/g, contextData.dateRange)
    .replace(/{totalProducts}/g, contextData.totalProducts ?? 'N/A')
    .replace(/{productsWithStock}/g, contextData.productsWithStock ?? 'N/A')
    .replace(/{totalSales}/g, contextData.totalSales ?? 'N/A')
    .replace(/{uniqueTickets}/g, contextData.uniqueTickets ?? 'N/A')
    .replace(/{totalCustomers}/g, contextData.totalCustomers ?? 'N/A')
    .replace(/{activeCustomers}/g, contextData.activeCustomers ?? 'N/A')
    .replace(/{aggregatedData}/g, formatAggregatedData(aggregatedData));

  return {
    systemPrompt: agentConfig.systemPrompt,
    userPrompt: contextInjection,
    role: agentConfig.role,
    agentType
  };
};

// ============================================================
// 4. UTILIDADES PARA CONSTRUCCIÓN DE RESPUESTA
// ============================================================

export const parseMarkdownResponse = (markdown) => {
  if (!markdown) return [];

  const sections = [];
  const lines = markdown.split('\n');
  let currentSection = null;
  let currentItems = [];

  const flushSection = () => {
    if (currentSection) {
      sections.push({
        title: currentSection,
        items: [...currentItems]
      });
      currentItems = [];
    }
  };

  const emojiHeaderRegex = /^(\s*)([📊⚠️💡📈💰🎯📋]+)\s*(.+)$/u;
  const bulletRegex = /^(\s*)[-*•]\s*(.+)$/;
  const numberedRegex = /^(\s*)\d+[.)]\s*(.+)$/;

  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const headerMatch = trimmed.match(emojiHeaderRegex);
    if (headerMatch) {
      flushSection();
      currentSection = headerMatch[3].replace(/:/g, '').trim();
      return;
    }

    const bulletMatch = trimmed.match(bulletRegex);
    if (bulletMatch && currentSection) {
      currentItems.push(bulletMatch[2]);
      return;
    }

    const numberedMatch = trimmed.match(numberedRegex);
    if (numberedMatch && currentSection) {
      currentItems.push(numberedMatch[2]);
      return;
    }

    if (currentSection && trimmed.length > 0) {
      currentItems.push(trimmed);
    }
  });

  flushSection();
  return sections;
};

export const validateAgentData = (agentType, data) => {
  if (!data || typeof data !== 'object') {
    return { valid: false, reason: 'Datos no disponibles' };
  }

  switch (agentType) {
    case 'inventoryAuditor':
      if (!data.menuStats || data.menuStats.totalProducts === 0) {
        return { valid: false, reason: 'No hay productos registrados' };
      }
      break;

    case 'financialAnalyst':
      if (!data.salesStats || data.salesStats.totalRevenue === 0) {
        return { valid: false, reason: 'No hay ventas en el período seleccionado' };
      }
      break;

    case 'customerStrategist':
      if (!data.customerBaseStats || data.customerBaseStats.activeThisPeriod === 0) {
        return { valid: false, reason: 'No hay clientes activos en el período' };
      }
      break;

    default:
      return { valid: false, reason: 'Agente no reconocido' };
  }

  return { valid: true };
};

export default {
  buildPrompt,
  parseMarkdownResponse,
  validateAgentData,
  formatAggregatedData
};
