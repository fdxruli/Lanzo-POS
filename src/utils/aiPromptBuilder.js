/**
 * AI Prompt Builder - Generador de prompts estructurados para agentes de IA.
 *
 * Construye prompts del sistema que inyectan contexto del negocio y exigen
 * respuestas JSON accionables. Mantiene parseMarkdownResponse como fallback
 * para proveedores que no respeten el contrato estructurado.
 */

const STRUCTURED_OUTPUT_INSTRUCTIONS = `

CONTRATO DE SALIDA OBLIGATORIO:
- Responde ÚNICAMENTE con JSON válido.
- NO uses Markdown.
- NO uses bloques de código.
- NO agregues texto antes ni después del JSON.
- Si falta información, usa arrays vacíos o explica la limitación dentro de findings/actions.
- No inventes métricas; si haces una inferencia, dilo explícitamente en evidence o reason.

SCHEMA EXACTO:
{
  "formatVersion": "1.0",
  "executiveSummary": "Resumen ejecutivo de 2 a 4 líneas, directo y útil para dueño de negocio local.",
  "severity": "success | info | warning | danger",
  "confidence": 0.0,
  "findings": [
    {
      "id": "finding-1",
      "title": "Título corto del hallazgo",
      "summary": "Explicación concreta basada en los datos.",
      "severity": "success | info | warning | danger",
      "metric": "Métrica principal si aplica, ejemplo: $850 en merma o 35% fuga de ticket",
      "evidence": ["Dato o tool que respalda el hallazgo"],
      "toolId": "id de herramienta interna si aplica"
    }
  ],
  "actions": [
    {
      "id": "action-1",
      "label": "Acción clara y corta",
      "description": "Qué debe hacer el usuario y por qué.",
      "priority": "high | medium | low",
      "type": "navigate | review | draft | checklist | manual",
      "route": "Ruta interna sugerida si aplica, por ejemplo /productos o /ventas?tab=waste",
      "reason": "Razón basada en datos o herramienta interna.",
      "expectedImpact": "Impacto esperado en venta, margen, operación o retención.",
      "confirmationRequired": true
    }
  ],
  "opportunities": [
    {
      "id": "opportunity-1",
      "title": "Oportunidad detectada",
      "description": "Explicación breve.",
      "impact": "high | medium | low",
      "effort": "high | medium | low",
      "firstStep": "Primer paso recomendado"
    }
  ],
  "questionsToAskUser": ["Pregunta útil si falta información para una mejor recomendación"],
  "toolReferences": ["ids de tools usadas o datos clave"]
}`;

const AGENT_PROMPTS = {
  inventoryAuditor: {
    role: 'Auditor de Inventario',
    systemPrompt: `Eres un auditor de inventario experto para retail, restaurantes y negocios locales. Analizas mermas, rotación de productos, capital detenido, niveles de stock y riesgos de agotado.

REGLAS DE RAZONAMIENTO:
- Sé directo y accionable.
- Prioriza por impacto económico y riesgo operativo.
- Usa los hallazgos de agentToolRun como herramientas internas, no como texto decorativo.
- Diferencia entre dato confirmado e inferencia.
- No propongas acciones destructivas automáticas; solo recomendaciones o navegación guiada.
- Para acciones sensibles usa confirmationRequired: true.${STRUCTURED_OUTPUT_INSTRUCTIONS}`,

    contextInjection: `
CONTEXTO DEL NEGOCIO:
- Tipo de negocio: {businessType}
- Período analizado: {dateRange}
- Total productos en menú: {totalProducts}
- Productos con stock activo: {productsWithStock}

DATOS AGREGADOS Y HERRAMIENTAS INTERNAS:
{aggregatedData}`
  },

  financialAnalyst: {
    role: 'Analista Financiero',
    systemPrompt: `Eres un analista financiero especializado en PYMEs, restaurantes, retail y comercios locales. Analizas ticket promedio, utilidad bruta, margen, patrones temporales, métodos de pago y oportunidades de ingreso.

REGLAS DE RAZONAMIENTO:
- Sé directo y accionable.
- Prioriza por ROI potencial y facilidad de ejecución.
- Usa los hallazgos de agentToolRun como herramientas internas, no como texto decorativo.
- Si detectas fuga de ticket, propone combos o acciones de venta cruzada.
- Si el margen es bajo, prioriza revisión de precio/costo antes de aumentar ventas.
- No inventes ingresos futuros; puedes estimar solo si aclaras que es una inferencia.${STRUCTURED_OUTPUT_INSTRUCTIONS}`,

    contextInjection: `
CONTEXTO DEL NEGOCIO:
- Tipo de negocio: {businessType}
- Período analizado: {dateRange}
- Total ventas procesadas: {totalSales}
- Tickets únicos: {uniqueTickets}

DATOS AGREGADOS Y HERRAMIENTAS INTERNAS:
{aggregatedData}`
  },

  customerStrategist: {
    role: 'Estratega de Clientes',
    systemPrompt: `Eres un estratega de clientes experto en retención, recurrencia, cobranza sana y fidelización para comercios locales. Analizas clientes activos, deuda, visitas, ticket y oportunidades de recompra.

REGLAS DE RAZONAMIENTO:
- Sé directo y accionable.
- Prioriza acciones que ayuden a que el cliente regrese o pague sin dañar la relación.
- Usa los hallazgos de agentToolRun como herramientas internas, no como texto decorativo.
- No expongas datos personales innecesarios; resume por patrones.
- Si hay deuda, sugiere seguimiento respetuoso y claro.
- Si hay pocos clientes registrados, recomienda mejorar captura de clientes en caja.${STRUCTURED_OUTPUT_INSTRUCTIONS}`,

    contextInjection: `
CONTEXTO DEL NEGOCIO:
- Tipo de negocio: {businessType}
- Período analizado: {dateRange}
- Total clientes en base: {totalCustomers}
- Clientes activos en período: {activeCustomers}

DATOS AGREGADOS Y HERRAMIENTAS INTERNAS:
{aggregatedData}`
  }
};

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
    || normalized.includes('discount')
    || normalized.includes('impact');
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

    return value.slice(0, 12).map((item, idx) => {
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
