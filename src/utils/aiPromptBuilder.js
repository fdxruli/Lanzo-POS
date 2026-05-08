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
// 2. FORMATO DE DATOS AGREGADOS (Stringificación)
// ============================================================

/**
 * Convierte un objeto de datos agregados en un string legible para IA
 * @param {Object} data - Datos agregados del agente
 * @returns {string} - Datos formateados en texto estructurado
 */
const formatAggregatedData = (data) => {
  if (!data || typeof data !== 'object') return 'Sin datos disponibles';

  const lines = [];

  // Procesar cada clave del objeto
  Object.entries(data).forEach(([key, value]) => {
    // Formatear según el tipo de dato
    if (Array.isArray(value)) {
      if (value.length === 0) return;
      
      // Array de objetos con estructura específica
      if (typeof value[0] === 'object' && value[0] !== null) {
        lines.push(`\n${formatKeyToTitle(key)}:`);
        value.slice(0, 10).forEach((item, idx) => {
          const itemStr = Object.entries(item)
            .map(([k, v]) => `${formatKeyToTitle(k)}: ${formatValue(v, k)}`)
            .join(', ');
          lines.push(`  ${idx + 1}. ${itemStr}`);
        });
        if (value.length > 10) {
          lines.push(`  ... y ${value.length - 10} registros más`);
        }
      } else {
        // Array simple
        lines.push(`${formatKeyToTitle(key)}: ${value.slice(0, 5).join(', ')}${value.length > 5 ? '...' : ''}`);
      }
    } else if (typeof value === 'object' && value !== null) {
      // Objeto anidado
      lines.push(`\n${formatKeyToTitle(key)}:`);
      Object.entries(value).forEach(([k, v]) => {
        lines.push(`  • ${formatKeyToTitle(k)}: ${formatValue(v, k)}`);
      });
    } else {
      // Valor primitivo
      lines.push(`${formatKeyToTitle(key)}: ${formatValue(value, key)}`);
    }
  });

  return lines.join('\n');
};

/**
 * Convierte camelCase a Título Legible
 */
const formatKeyToTitle = (key) => {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .replace(/\b\w/g, str => str.toUpperCase());
};

/**
 * Formatea valores según su tipo
 */
const formatValue = (value, key = '') => {
  if (typeof value === 'number') {
    // Moneda
    if (value >= 100 || value <= -100) {
      return `$${value.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    // Porcentaje
    if (value >= 0 && value <= 1 && key && key.toLowerCase().includes('ratio')) {
      return `${(value * 100).toFixed(1)}%`;
    }
    // Número normal
    return value.toLocaleString('es-MX');
  }
  
  if (typeof value === 'boolean') {
    return value ? 'Sí' : 'No';
  }
  
  if (value instanceof Date) {
    return value.toLocaleDateString('es-MX');
  }
  
  return String(value);
};

// ============================================================
// 3. CONSTRUCTOR DE PROMPT FINAL
// ============================================================

/**
 * Construye el prompt completo para un agente específico
 * @param {string} agentType - Tipo de agente ('inventoryAuditor', 'financialAnalyst', 'customerStrategist')
 * @param {Object} aggregatedData - Datos agregados del buildAgentPayload
 * @param {Object} businessContext - Contexto del negocio (tipo, fecha, etc.)
 * @returns {Object} - { systemPrompt, userPrompt, role }
 */
export const buildPrompt = (agentType, aggregatedData, businessContext = {}) => {
  const agentConfig = AGENT_PROMPTS[agentType];
  
  if (!agentConfig) {
    throw new Error(`Agente no reconocido: ${agentType}`);
  }

  // Construir inyección de contexto
  const contextData = {
    businessType: businessContext.businessType || 'No especificado',
    dateRange: businessContext.dateRange || 'No especificado',
    ...aggregateContextFields(agentType, aggregatedData, businessContext)
  };

  const contextInjection = agentConfig.contextInjection
    .replace(/{businessType}/g, contextData.businessType)
    .replace(/{dateRange}/g, contextData.dateRange)
    .replace(/{totalProducts}/g, contextData.totalProducts || 'N/A')
    .replace(/{productsWithStock}/g, contextData.productsWithStock || 'N/A')
    .replace(/{totalSales}/g, contextData.totalSales || 'N/A')
    .replace(/{uniqueTickets}/g, contextData.uniqueTickets || 'N/A')
    .replace(/{totalCustomers}/g, contextData.totalCustomers || 'N/A')
    .replace(/{activeCustomers}/g, contextData.activeCustomers || 'N/A')
    .replace(/{aggregatedData}/g, formatAggregatedData(aggregatedData));

  return {
    systemPrompt: agentConfig.systemPrompt,
    userPrompt: contextInjection,
    role: agentConfig.role,
    agentType
  };
};

/**
 * Agrega campos de contexto específicos según el tipo de agente
 */
const aggregateContextFields = (agentType, aggregatedData, businessContext) => {
  const context = {};

  switch (agentType) {
    case 'inventoryAuditor':
      context.totalProducts = aggregatedData?.menuStats?.totalProducts || 0;
      context.productsWithStock = aggregatedData?.menuStats?.productsWithStock || 0;
      break;

    case 'financialAnalyst':
      context.totalSales = aggregatedData?.salesStats?.totalTransactions || 0;
      context.uniqueTickets = aggregatedData?.salesStats?.uniqueTickets || 0;
      break;

    case 'customerStrategist':
      context.totalCustomers = businessContext.totalCustomers || 0;
      context.activeCustomers = aggregatedData?.customerStats?.activeCustomers || 0;
      break;

    default:
      break;
  }

  return context;
};

// ============================================================
// 4. UTILIDADES PARA CONSTRUCCIÓN DE RESPUESTA
// ============================================================

/**
 * Parsea una respuesta Markdown de la IA en componentes React
 * @param {string} markdown - Respuesta en Markdown
 * @returns {Array} - Array de secciones parseadas
 */
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

    // Detectar header con emoji
    const headerMatch = trimmed.match(emojiHeaderRegex);
    if (headerMatch) {
      flushSection();
      currentSection = headerMatch[3].replace(/:/g, '').trim();
      return;
    }

    // Detectar bullet point
    const bulletMatch = trimmed.match(bulletRegex);
    if (bulletMatch && currentSection) {
      currentItems.push(bulletMatch[2]);
      return;
    }

    // Detectar número
    const numberedMatch = trimmed.match(numberedRegex);
    if (numberedMatch && currentSection) {
      currentItems.push(numberedMatch[2]);
      return;
    }

    // Línea de texto normal (agregar como item si hay sección activa)
    if (currentSection && trimmed.length > 0) {
      currentItems.push(trimmed);
    }
  });

  flushSection();
  return sections;
};

/**
 * Valida que los datos agregados cumplan con el mínimo para análisis
 * @param {string} agentType - Tipo de agente
 * @param {Object} data - Datos agregados
 * @returns {{ valid: boolean, reason?: string }}
 */
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
      if (!data.customerStats || data.customerStats.activeCustomers === 0) {
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
