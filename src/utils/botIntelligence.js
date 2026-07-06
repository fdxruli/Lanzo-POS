// src/utils/botIntelligence.js
/**
 * MOTOR DE INTELIGENCIA DEL BOT - VERSIÓN MEJORADA
 * Sistema de procesamiento de lenguaje natural y análisis contextual
 */

import { loadData, STORES } from '../services/db';
import { getExpiringProductsReport, getLowStockProductsReport } from '../services/inventoryAnalysis';
import { INTENT_PATTERNS, CONVERSATION_CONTEXT } from './IntentPatterns';
import {
  normalizeText,
  tokenize,
  removeStopWords,
  extractNumbers,
  extractTimeframe,
  extractNames,
  calculateSimilarity,
  findMostSimilar,
  correctTypos,
  analyzeSentiment,
  conversationMemory,
  isFuzzyMatch
} from './nlpEngine';

// ============================================================
// 1. DETECCIÓN DE INTENCIÓN MEJORADA
// ============================================================

/**
 * Detecta la intención del usuario con sistema de scoring
 */
export const detectIntent = (userMessage) => {
  console.log('🔍 Analizando mensaje:', userMessage);
  
  // Normalizar y corregir el mensaje
  const correctedMessage = correctTypos(userMessage);
  const normalized = normalizeText(correctedMessage);
  const sentiment = analyzeSentiment(normalized);
  
  console.log('😊 Sentimiento:', sentiment);
  
  // Verificar contextos conversacionales (saludos, despedidas, etc.)
  for (const [contextType, contextData] of Object.entries(CONVERSATION_CONTEXT)) {
    for (const pattern of contextData.patterns) {
      if (pattern.test(normalized)) {
        console.log('✅ Contexto detectado:', contextType);
        return contextType;
      }
    }
  }
  
  // Calcular scores para cada intención
  const intentScores = {};
  
  for (const [intentName, intentData] of Object.entries(INTENT_PATTERNS)) {
    let score = 0;
    
    // Puntuación por patrones regex
    for (const pattern of intentData.patterns) {
      if (pattern.test(normalized)) {
        score += 10; // Alto peso para coincidencia de patrón
        break;
      }
    }
    
    // Puntuación por keywords
    const tokens = tokenize(normalized);
    const meaningfulTokens = removeStopWords(tokens);
    
    for (const keyword of intentData.keywords) {
      const keywordNorm = normalizeText(keyword);
      
      const matchFound = meaningfulTokens.some(token =>
        isFuzzyMatch(token, keywordNorm, 0.70)
      );
      if (matchFound) {
        score += 3
      }
    }
    
    // Bonus por similitud con ejemplos
    for (const example of intentData.examples) {
      const similarity = calculateSimilarity(normalized, example);
      if (similarity > 0.7) {
        score += 5 * similarity;
      }
    }
    
    if (score > 0) {
      intentScores[intentName] = score;
    }
  }
  
  // Ordenar por score y retornar la mejor coincidencia
  const sortedIntents = Object.entries(intentScores)
    .sort((a, b) => b[1] - a[1]);
  
  console.log('📊 Scores de intención:', intentScores);
  
  if (sortedIntents.length > 0 && sortedIntents[0][1] >= 3) {
    console.log('✅ Intención detectada:', sortedIntents[0][0], 'con score:', sortedIntents[0][1]);
    return sortedIntents[0][0];
  }
  
  console.log('❓ Intención desconocida');
  return 'unknown';
};

// ============================================================
// 2. EXTRACCIÓN DE ENTIDADES MEJORADA
// ============================================================

/**
 * Extrae entidades relevantes del mensaje
 */
export const extractEntities = (userMessage) => {
  const entities = {
    timeframe: null,
    productName: null,
    customerName: null,
    amount: null,
    numbers: []
  };
  
  // Extraer período de tiempo
  entities.timeframe = extractTimeframe(userMessage);
  
  // Extraer nombres
  const names = extractNames(userMessage);
  if (names.length > 0) {
    entities.productName = names[0];
    if (names.length > 1) {
      entities.customerName = names[1];
    }
  }
  
  // Extraer números
  entities.numbers = extractNumbers(userMessage);
  if (entities.numbers.length > 0) {
    entities.amount = entities.numbers[0];
  }
  
  console.log('🎯 Entidades extraídas:', entities);
  
  return entities;
};

// ============================================================
// 3. CALCULADORES DE DATOS MEJORADOS
// ============================================================

/**
 * Calcula reporte de ventas con más detalles
 */
export const calculateSalesReport = async (timeframe = 'today') => {
  const sales = await loadData(STORES.SALES) || [];
  const now = new Date();
  const startDate = new Date();
  
  // Configurar rango de fechas
  switch (timeframe.type || timeframe) {
    case 'today':
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'yesterday': {
      startDate.setDate(startDate.getDate() - 1);
      startDate.setHours(0, 0, 0, 0);
      const endYesterday = new Date(startDate);
      endYesterday.setHours(23, 59, 59, 999);
      now.setTime(endYesterday.getTime());
      break;
    }
    case 'week':
      startDate.setDate(startDate.getDate() - 7);
      break;
    case 'month':
      startDate.setMonth(startDate.getMonth() - 1);
      break;
    case 'custom':
      startDate.setDate(startDate.getDate() - (timeframe.days || 7));
      break;
  }
  
  // Filtrar ventas del período
  const filteredSales = sales.filter(s => {
    const saleDate = new Date(s.timestamp);
    return saleDate >= startDate && saleDate <= now && s.fulfillmentStatus !== 'cancelled';
  });
  
  // Calcular métricas
  const total = filteredSales.reduce((sum, s) => sum + (s.total || 0), 0);
  const count = filteredSales.length;
  
  let profit = 0;
  let totalCost = 0;
  
  filteredSales.forEach(sale => {
    if (sale.items) {
      sale.items.forEach(item => {
        const cost = item.cost || 0;
        const price = item.price || 0;
        const qty = item.quantity || 0;
        
        totalCost += cost * qty;
        profit += (price - cost) * qty;
      });
    }
  });
  
  const avgTicket = count > 0 ? total / count : 0;
  const margin = total > 0 ? (profit / total) * 100 : 0;
  
  return { 
    total, 
    count, 
    profit,
    totalCost,
    avgTicket,
    margin,
    timeframe: timeframe.type || timeframe 
  };
};

/**
 * Obtiene productos con stock bajo con más detalles
 */
export const getLowStockProducts = async (options = {}) => {
  return getLowStockProductsReport({ limit: 10, ...options });
};

export const getExpiringProducts = async (daysThreshold = 7) => {
  const report = await getExpiringProductsReport({ daysThreshold });
  return report.slice(0, 10);
};

/**
 * Obtiene clientes con deuda
 */
export const getCustomersWithDebt = async () => {
  const customers = await loadData(STORES.CUSTOMERS) || [];
  
  const debtors = customers
    .filter(c => c.debt > 0)
    .map(c => ({
      ...c,
      debtAge: calculateDebtAge(c)
    }))
    .sort((a, b) => b.debt - a.debt);
  
  return debtors.slice(0, 10);
};

/**
 * Calcula antigüedad de la deuda (simulado por ahora)
 */
const calculateDebtAge = () => {
  // Por ahora retornamos 'reciente', pero esto debería calcularse con las ventas
  return 'reciente';
};

/**
 * Busca un producto por nombre con tolerancia a errores
 */
export const searchProductByName = async (productName) => {
  const products = await loadData(STORES.MENU) || [];
  
  // Buscar coincidencia exacta primero
  const exactMatch = products.find(p => 
    normalizeText(p.name) === normalizeText(productName) ||
    p.barcode === productName
  );
  
  if (exactMatch) return exactMatch;
  
  // Buscar por similitud
  return findMostSimilar(productName, products, 0.6);
};

/**
 * Obtiene los productos más vendidos
 */
export const getTopProducts = async (timeframe = 'month', limit = 10) => {
  const sales = await loadData(STORES.SALES) || [];
  const startDate = new Date();
  
  switch (timeframe) {
    case 'week':
      startDate.setDate(startDate.getDate() - 7);
      break;
    case 'month':
      startDate.setMonth(startDate.getMonth() - 1);
      break;
  }
  
  const productSales = new Map();
  
  sales.forEach(sale => {
    const saleDate = new Date(sale.timestamp);
    if (saleDate >= startDate && sale.fulfillmentStatus !== 'cancelled') {
      sale.items?.forEach(item => {
        const key = item.name;
        const current = productSales.get(key) || { 
          name: key, 
          quantity: 0, 
          revenue: 0,
          profit: 0
        };
        
        current.quantity += item.quantity || 0;
        current.revenue += (item.price * item.quantity) || 0;
        current.profit += ((item.price - (item.cost || 0)) * item.quantity) || 0;
        
        productSales.set(key, current);
      });
    }
  });
  
  return Array.from(productSales.values())
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, limit);
};

// ============================================================
// 4. GENERADOR DE RESPUESTAS MEJORADO
// ============================================================

/**
 * Genera respuestas inteligentes y contextuales
 */
const getContextSummary = (context = {}) => {
  const pageLabel = context.page?.label || 'esta seccion';
  const businessLabel = context.businessLabel || 'tu negocio';
  const insights = Array.isArray(context.businessInsights) ? context.businessInsights : [];

  return {
    pageLabel,
    businessLabel,
    insightText: insights.length > 0 ? insights.join(' | ') : null
  };
};

export const generateResponse = async (intent, entities, context = {}) => {
  console.log('💬 Generando respuesta para:', intent);
  const contextSummary = getContextSummary(context);
  
  // Manejar contextos conversacionales
  if (CONVERSATION_CONTEXT[intent]) {
    const responses = CONVERSATION_CONTEXT[intent].responses;
    const randomResponse = responses[Math.floor(Math.random() * responses.length)];
    
    return {
      title: '👋 Hola',
      message: `${randomResponse}\n\nEstoy en ${contextSummary.pageLabel} y puedo ajustar la ayuda a ${contextSummary.businessLabel}.`,
      tips: contextSummary.insightText ? [contextSummary.insightText] : [],
      actions: []
    };
  }
  const responses = {
    sales_report: async () => {
      const report = await calculateSalesReport(entities.timeframe || 'today');
      const periodText = {
        today: 'hoy',
        yesterday: 'ayer',
        week: 'esta semana',
        month: 'este mes',
        custom: `los últimos ${entities.timeframe.days} días`
      }[report.timeframe];
      
      return {
        title: `Reporte de Ventas - ${periodText}`,
        message: `Has vendido $${report.total.toFixed(2)} en ${report.count} venta${report.count !== 1 ? 's' : ''}.`,
        tips: [
          `Ganancia neta: $${report.profit.toFixed(2)} (${report.margin.toFixed(1)}% de margen)`,
          `Ticket promedio: $${report.avgTicket.toFixed(2)}`,
          `Costo de mercancía vendida: $${report.totalCost.toFixed(2)}`
        ],
        actions: [
          { label: 'Ver Historial Completo', path: '/ventas', icon: '📈' }
        ]
      };
    },
    
    profit_report: async () => {
      const report = await calculateSalesReport(entities.timeframe || 'today');
      const periodText = {
        today: 'hoy',
        yesterday: 'ayer',
        week: 'esta semana',
        month: 'este mes'
      }[report.timeframe] || 'en el período';
      
      return {
        title: `Reporte de Ganancias - ${periodText}`,
        message: `Tu utilidad neta ${periodText} es de **$${report.profit.toFixed(2)}**.`,
        tips: [
          `Margen de ganancia: ${report.margin.toFixed(1)}%`,
          `Ventas totales: $${report.total.toFixed(2)}`,
          `Costos: $${report.totalCost.toFixed(2)}`,
          report.margin < 20 ? 'Considera revisar tus precios, el margen es bajo' : 'Margen saludable'
        ],
        actions: [
          { label: 'Ver Dashboard', path: '/ventas', icon: '' }
        ]
      };
    },
    
    low_stock: async () => {
      const lowStock = await getLowStockProducts();
      
      if (lowStock.length === 0) {
        return {
          title: '✅ Inventario Saludable',
          message: 'Excelente, no hay productos con stock bajo en este momento.',
          tips: ['Continúa monitoreando tu inventario regularmente'],
          actions: []
        };
      }
      
      const criticalItems = lowStock.filter(p => p.urgency < 0.5);
      const warningItems = lowStock.filter(p => p.urgency >= 0.5 && p.urgency < 1);
      
      let summary = `Hay ${lowStock.length} producto${lowStock.length !== 1 ? 's' : ''} que necesitan atención:\n\n`;
      
      if (criticalItems.length > 0) {
        summary += `Críticos (${criticalItems.length}):\n`;
        criticalItems.slice(0, 3).forEach(p => {
          summary += `• ${p.name}: ${p.stock} ${p.saleType === 'bulk' ? 'kg' : 'pzas'} (pedir ${p.deficit})\n`;
        });
      }
      
      if (warningItems.length > 0) {
        summary += `\nAdvertencia (${warningItems.length}):\n`;
        warningItems.slice(0, 2).forEach(p => {
          summary += `• ${p.name}: ${p.stock} ${p.saleType === 'bulk' ? 'kg' : 'pzas'}\n`;
        });
      }
      
      return {
        title: 'Stock Bajo Detectado',
        message: summary,
        tips: [
          `Total a pedir: ${lowStock.reduce((sum, p) => sum + p.deficit, 0)} unidades`,
          'Ve a Reabastecimiento para generar orden de compra'
        ],
        actions: [
          { label: 'Ver Lista Completa', path: '/productos', icon: '', highlight: true }
        ]
      };
    },
    
    product_search: async () => {
      if (!entities.productName) {
        return {
          title: 'Búsqueda de Productos',
          message: 'Por favor, especifica el nombre del producto que buscas.',
          tips: ['Ejemplo: "¿Tengo Coca-Cola?" o "Buscar arroz"'],
          actions: [
            { label: 'Ir a Inventario', path: '/productos', icon: '' }
          ]
        };
      }
      
      const product = await searchProductByName(entities.productName);
      
      if (!product) {
        return {
          title: 'Producto No Encontrado',
          message: `No encontré "${entities.productName}" en tu inventario.`,
          tips: [
            'Verifica la ortografía',
            'Intenta buscar por código de barras',
            'Puede que el producto esté inactivo'
          ],
          actions: [
            { label: 'Agregar Nuevo Producto', path: '/productos?tab=add', icon: '', highlight: true },
            { label: 'Ver Inventario', path: '/productos', icon: '' }
          ]
        };
      }
      
      const statusEmoji = product.stock > (product.minStock || 5) ? '✅' : '⚠️';
      const stockStatus = product.stock > (product.minStock || 5) ? 'Stock saludable' : 'Stock bajo - considera reabastecer';
      
      return {
        title: `${statusEmoji} ${product.name}`,
        message: `Stock actual: ${product.stock} ${product.saleType === 'bulk' ? 'kg' : 'piezas'}\nPrecio: $${product.price.toFixed(2)}\nCosto: $${(product.cost || 0).toFixed(2)}`,
        tips: [
          stockStatus,
          `Margen: ${product.price > 0 ? (((product.price - (product.cost || 0)) / product.price) * 100).toFixed(1) : 0}%`,
          product.location ? `Ubicación: ${product.location}` : 'Sin ubicación asignada'
        ],
        actions: [
          { label: 'Ver Detalles', path: '/productos', icon: '' },
          product.stock <= (product.minStock || 5) ? 
            { label: 'Agregar Stock', path: '/productos?tab=batches', icon: '', highlight: true } : null
        ].filter(Boolean)
      };
    },
    
    customer_debt: async () => {
      const debtors = await getCustomersWithDebt();
      
      if (debtors.length === 0) {
        return {
          title: 'Sin Deudas Pendientes',
          message: '¡Excelente! No hay clientes con saldo pendiente.',
          tips: ['Mantén un control estricto del crédito para evitar deudas'],
          actions: []
        };
      }
      
      const totalDebt = debtors.reduce((sum, c) => sum + c.debt, 0);
      const criticalDebtors = debtors.filter(c => c.debt > 500);
      
      let message = `Tienes $${totalDebt.toFixed(2)} pendientes de cobro en ${debtors.length} cliente${debtors.length !== 1 ? 's' : ''}.\n\n`;
      
      if (criticalDebtors.length > 0) {
        message += `Deudas altas (>${500}):\n`;
        criticalDebtors.slice(0, 3).forEach(c => {
          message += `• ${c.name}: $${c.debt.toFixed(2)}\n`;
        });
      }
      
      const regularDebtors = debtors.filter(c => c.debt <= 500);
      if (regularDebtors.length > 0) {
        message += `\nOtras deudas:\n`;
        regularDebtors.slice(0, 3).forEach(c => {
          message += `• ${c.name}: $${c.debt.toFixed(2)}\n`;
        });
      }
      
      return {
        title: 'Cuentas por Cobrar',
        message,
        tips: [
          `Deuda promedio: $${(totalDebt / debtors.length).toFixed(2)}`,
          'Envía recordatorios por WhatsApp desde Clientes',
          'Considera ofrecer descuentos por pronto pago'
        ],
        actions: [
          { label: 'Ver Todos los Clientes', path: '/clientes', icon: '', highlight: true }
        ]
      };
    },
    
    best_sellers: async () => {
      const topProducts = await getTopProducts('month', 5);
      
      if (topProducts.length === 0) {
        return {
          title: 'Productos Más Vendidos',
          message: 'Aún no hay suficientes datos de ventas para generar este reporte.',
          tips: ['Realiza más ventas para ver estadísticas'],
          actions: []
        };
      }
      
      const list = topProducts
        .map((p, i) => {
          return `${i + 1}. ${p.name}\n   ${p.quantity} vendidos • $${p.revenue.toFixed(2)} • Ganancia: $${p.profit.toFixed(2)}`;
        })
        .join('\n\n');
      
      const totalRevenue = topProducts.reduce((sum, p) => sum + p.revenue, 0);
      const totalProfit = topProducts.reduce((sum, p) => sum + p.profit, 0);
      
      return {
        title: '🏆 Top 5 Productos del Mes',
        message: list,
        tips: [
          `Estos productos representan $${totalRevenue.toFixed(2)} en ventas`,
          `Ganancia total: $${totalProfit.toFixed(2)}`,
          '💡 Asegúrate de mantener buen stock de estos productos'
        ],
        actions: [
          { label: 'Ver Análisis Completo', path: '/ventas', icon: '' },
          { label: 'Verificar Stock', path: '/productos', icon: '' }
        ]
      };
    },
    
    expiration_alert: async () => {
      const days = entities.amount || 7;
      const expiring = await getExpiringProducts(days);
      
      if (expiring.length === 0) {
        return {
          title: 'Sin Productos Próximos a Vencer',
          message: `No hay productos que venzan en los próximos ${days} días.`,
          tips: ['Excelente control de inventario'],
          actions: []
        };
      }
      
      const critical = expiring.filter(p => p.urgencyLevel === 'critical');
      const high = expiring.filter(p => p.urgencyLevel === 'high');
      
      let message = `Hay ${expiring.length} producto${expiring.length !== 1 ? 's' : ''} próximos a vencer:\n\n`;
      
      if (critical.length > 0) {
        message += `Urgente (≤2 días):\n`;
        critical.forEach(p => {
          message += `• ${p.name}: ${p.daysLeft} día${p.daysLeft !== 1 ? 's' : ''} restante${p.daysLeft !== 1 ? 's' : ''}\n`;
        });
      }
      
      if (high.length > 0) {
        message += `\n🟡 Atención (3-5 días):\n`;
        high.slice(0, 3).forEach(p => {
          message += `• ${p.name}: ${p.daysLeft} días\n`;
        });
      }
      
      return {
        title: 'Productos por Vencer',
        message,
        tips: [
          'Considera hacer promociones para estos productos',
          'Verifica las fechas físicamente',
          'Actualiza el sistema con fechas correctas'
        ],
        actions: [
          { label: 'Ver Lista Completa', path: '/ventas?tab=expiration', icon: '', highlight: true }
        ]
      };
    },
    
    help_general: () => {
      return {
        title: 'Centro de Ayuda',
        message: '¡Hola! Soy tu asistente Lanzo. Puedo ayudarte con:\n\n📊 **Reportes y Análisis**\n• Ventas y ganancias\n• Productos más vendidos\n• Tendencias del negocio\n\n📦 **Inventario**\n• Stock bajo y reabastecimiento\n• Búsqueda de productos\n• Alertas de caducidad\n\n👥 **Clientes**\n• Cuentas por cobrar\n• Mejores clientes\n\n🛠️ **Ayuda y Configuración**\n• Tutoriales paso a paso\n• Resolución de problemas',
        tips: [
          '💡 Pregúntame cosas como:',
          '"¿Cuánto vendí esta semana?"',
          '"¿Qué productos están por caducar?"',
          '"¿Quién me debe dinero?"',
          '"¿Cuáles son mis productos más vendidos?"'
        ],
        actions: [
          { label: 'Saber más en soporte', path: '/acerca-de', icon: '📚' }
        ]
      };
    },
    
    cash_register: () => {
      return {
        title: 'Caja y corte',
        message: 'En Caja puedes abrir turno, registrar entradas o salidas, revisar movimientos y hacer el corte cuando termines operación.',
        tips: [
          'Si la caja no cuadra, revisa ventas canceladas, salidas y pagos en efectivo.',
          'Registra gastos o retiros como movimientos para que el corte sea confiable.',
          'Haz el corte al final del turno antes de cambiar de cajero.'
        ],
        actions: [
          { label: 'Abrir caja', path: '/caja', icon: '', highlight: true },
          { label: 'Ver ventas', path: '/ventas', icon: '' }
        ]
      };
    },

    customer_payment: () => {
      return {
        title: 'Registrar abono',
        message: 'Para registrar un abono, entra a Clientes, localiza al cliente con deuda y captura el pago desde su cuenta.',
        tips: [
          'Confirma el saldo antes de guardar el abono.',
          'Registra la forma de pago para que caja y reportes cuadren.',
          'Entrega o envía comprobante cuando aplique.'
        ],
        actions: [
          { label: 'Ir a clientes', path: '/clientes', icon: '', highlight: true },
          { label: 'Ver caja', path: '/caja', icon: '' }
        ]
      };
    },

    orders_help: () => {
      return {
        title: 'Pedidos y cocina',
        message: 'En Pedidos puedes dar seguimiento a comandas, estados de preparación y entregas. Es útil para restaurante, cafetería o fonda.',
        tips: [
          'Marca un pedido como listo cuando cocina termina.',
          'Confirma entregado para cerrar el flujo operativo.',
          'Si usas mesas, revisa la cuenta antes de cobrar.'
        ],
        actions: [
          { label: 'Ver pedidos', path: '/pedidos', icon: '', highlight: true },
          { label: 'Ir a vender', path: '/', icon: '' }
        ]
      };
    },

    help_product: () => {
      return {
        title: 'Cómo Agregar Productos',
        message: 'Proceso paso a paso:\n\n1️⃣ Ve a la pestaña "Productos".\n2️⃣ Click en "Añadir Producto".\n3️⃣ Llena la información:\n   • Nombre del producto\n   • Código de barras (opcional)\n   • Precio y costo\n   • Stock inicial(solo en modo asistido)\n4️⃣ Guarda',
        tips: [
          '📱 Usa el escáner para capturar códigos de barras',
          '⚙️ Configura stock mínimo para recibir alertas',
          '📸 Agrega fotos para identificar productos rápidamente',
          '📁 Organiza por categorías para mejor control'
        ],
        actions: [
          { label: 'Ir a Agregar Producto', path: '/productos?tab=add', icon: '', highlight: true },
          { label: 'Ayuda de soporte', path: '/acerca-de', icon: '' }
        ]
      };
    },

    help_sale: () => {
      return {
        title: 'Cómo hacer una venta',
        message: 'Desde Punto de venta puedes escanear o buscar productos, revisar cantidades en el carrito y cobrar cuando el total sea correcto.',
        tips: [
          context.cartCount > 0 ? `Ya tienes ${context.cartCount} artículo(s) en el carrito.` : 'Empieza escaneando un código o buscando por nombre.',
          'Antes de cobrar revisa cantidades, descuentos y forma de pago.',
          'Si trabajas restaurante, confirma mesa o pedido antes de cerrar.'
        ],
        actions: [
          { label: 'Ir a Punto de venta', path: '/', icon: '', highlight: true },
          { label: 'Ver caja', path: '/caja', icon: '' }
        ]
      };
    },

    help_inventory: () => {
      return {
        title: 'Gestionar inventario',
        message: 'Para mantener el inventario confiable, registra entradas por lotes cuando recibas mercancía y usa stock mínimo para saber qué reponer.',
        tips: [
          context.lowStockCount > 0 ? `Tienes ${context.lowStockCount} producto(s) con stock bajo.` : 'No detecto alertas de stock bajo en el resumen actual.',
          'Usa lotes cuando necesites controlar caducidad, costo o entradas parciales.',
          'Revisa precios y costos para que los reportes de ganancia sean útiles.'
        ],
        actions: [
          { label: 'Ver productos', path: '/productos', icon: '', highlight: true },
          { label: 'Gestionar lotes', path: '/productos?tab=batches', icon: '' }
        ]
      };
    },

    backup_help: () => {
      return {
        title: 'Respaldo de datos',
        message: 'El respaldo protege ventas, productos, clientes y configuración. Hazlo antes de mantenimiento, cambios grandes de inventario o cierre semanal.',
        tips: [
          'Ve a Configuración y entra a Datos y Mantenimiento.',
          'Guarda el archivo en una ubicación que puedas recuperar.',
          'Si usas sincronización en la nube, revisa que no haya errores pendientes.'
        ],
        actions: [
          { label: 'Ir a respaldos', path: '/configuracion?tab=maintenance', icon: '', highlight: true },
          { label: 'Soporte', path: '/acerca-de', icon: '' }
        ]
      };
    },

    sync_data: () => {
      return {
        title: 'Sincronizar información',
        message: 'Si notas datos atrasados, primero revisa conexión y estado del sistema. Después actualiza la vista o entra a mantenimiento si el problema continúa.',
        tips: [
          'No abras dos pestañas del POS al mismo tiempo.',
          'Si hay ventas recientes, espera a que termine la sincronización antes de cerrar.',
          'Haz respaldo antes de ejecutar reparaciones.'
        ],
        actions: [
          { label: 'Ver configuración', path: '/configuracion?tab=maintenance', icon: '', highlight: true },
          { label: 'Ver reportes', path: '/ventas', icon: '' }
        ]
      };
    },

    change_settings: () => {
      return {
        title: 'Configuración del sistema',
        message: 'Puedes ajustar datos del negocio, usuarios, operación, respaldos y mantenimiento desde Configuración.',
        tips: [
          `Estás trabajando en ${contextSummary.pageLabel}.`,
          'Algunos cambios pueden requerir permisos de administrador.',
          'Para cambios de licencia o datos sensibles, usa la sección Acerca de o soporte.'
        ],
        actions: [
          { label: 'Abrir configuración', path: '/configuracion', icon: '', highlight: true },
          { label: 'Acerca de', path: '/acerca-de', icon: '' }
        ]
      };
    },

    quick_sale: () => {
      return {
        title: 'Venta rápida',
        message: 'Para cobrar rápido, entra al Punto de venta, escanea los productos, confirma el total y presiona cobrar.',
        tips: [
          'Usa el lector de código de barras para evitar capturas manuales.',
          'Si el producto no existe, agrégalo desde Productos antes de vender.',
          context.lowStockCount > 0 ? 'Después de la venta revisa stock bajo para reabastecer.' : 'Mantén actualizado el stock mínimo para recibir alertas.'
        ],
        actions: [
          { label: 'Ir a vender', path: '/', icon: '', highlight: true },
          { label: 'Agregar producto', path: '/productos?tab=add', icon: '' }
        ]
      };
    },

    add_stock: () => {
      return {
        title: 'Agregar stock',
        message: 'Registra la entrada desde Productos o Gestionar lotes. Eso mantiene consistente el inventario y los costos.',
        tips: [
          'Captura cantidad, costo y caducidad si aplica.',
          'Para farmacia o alimentos, usa lotes para controlar vencimientos.',
          'Evita editar existencias sin registrar la entrada cuando quieras trazabilidad.'
        ],
        actions: [
          { label: 'Gestionar lotes', path: '/productos?tab=batches', icon: '', highlight: true },
          { label: 'Ver productos', path: '/productos', icon: '' }
        ]
      };
    },

    system_status: () => {
      return {
        title: 'Estado del sistema',
        message: 'Puedo ayudarte a revisar señales visibles: licencia, respaldos, caja, stock bajo y datos recientes del negocio.',
        tips: [
          contextSummary.insightText || 'No hay alertas críticas en el contexto actual.',
          context.licenseDays <= 7 ? `La licencia vence en ${context.licenseDays} día(s).` : 'La licencia no aparece como crítica.',
          context.lowStockCount > 0 ? 'Hay productos por revisar en inventario.' : 'El resumen no marca stock bajo.'
        ],
        actions: [
          { label: 'Ver reportes', path: '/ventas', icon: '', highlight: true },
          { label: 'Mantenimiento', path: '/configuracion?tab=maintenance', icon: '' }
        ]
      };
    },

    customer_search: () => {
      return {
        title: 'Buscar cliente',
        message: 'En Clientes puedes buscar por nombre o teléfono, abrir historial, registrar abonos y revisar cuentas pendientes.',
        tips: [
          'Si el cliente tiene crédito, verifica saldo antes de vender fiado.',
          'Usa historial para confirmar compras anteriores.',
          'Mantén teléfono actualizado para enviar recibos o recordatorios.'
        ],
        actions: [
          { label: 'Ir a clientes', path: '/clientes', icon: '', highlight: true }
        ]
      };
    },

    best_customers: () => {
      return {
        title: 'Clientes importantes',
        message: 'Para identificar mejores clientes, revisa historial y reportes. Prioriza frecuencia de compra, ticket promedio y saldos pendientes.',
        tips: [
          'Los clientes frecuentes pueden recibir promociones o seguimiento.',
          'No confundas alto consumo con buen crédito si tienen deuda vencida.',
          'Revisa cuentas por cobrar antes de ampliar crédito.'
        ],
        actions: [
          { label: 'Ver clientes', path: '/clientes', icon: '', highlight: true },
          { label: 'Ver reportes', path: '/ventas', icon: '' }
        ]
      };
    },

    slow_movers: () => {
      return {
        title: 'Productos de baja rotación',
        message: 'Busca productos con poca venta y mucho stock. Pueden necesitar promoción, ajuste de precio o dejar de reponerse.',
        tips: [
          'Compara ventas del mes contra existencias actuales.',
          'Antes de bajar precio, revisa margen y caducidad.',
          'En alimentos o farmacia, prioriza lo que vence pronto.'
        ],
        actions: [
          { label: 'Ver reportes', path: '/ventas', icon: '', highlight: true },
          { label: 'Ver inventario', path: '/productos', icon: '' }
        ]
      };
    },

    trend_analysis: () => {
      return {
        title: 'Tendencias del negocio',
        message: 'Revisa si las ventas suben o bajan comparando día, semana y mes. El dashboard te ayuda a ver productos fuertes y horarios con más movimiento.',
        tips: [
          'Mira ticket promedio además de venta total.',
          'Cruza productos más vendidos con stock bajo.',
          'Si baja la venta, revisa precios, disponibilidad y clientes frecuentes.'
        ],
        actions: [
          { label: 'Abrir reportes', path: '/ventas', icon: '', highlight: true }
        ]
      };
    },

    projection: () => {
      return {
        title: 'Proyección de ventas',
        message: 'La proyección más útil sale de comparar el ritmo de ventas actual contra semanas anteriores.',
        tips: [
          'Usa ventas del día para estimar cierre diario.',
          'Para compras, combina proyección con stock bajo.',
          'Evita proyectar con días atípicos sin revisar el contexto.'
        ],
        actions: [
          { label: 'Ver dashboard', path: '/ventas', icon: '', highlight: true },
          { label: 'Ver stock bajo', path: '/ventas?tab=restock', icon: '' }
        ]
      };
    },

    inventory_value: () => {
      return {
        title: 'Valor del inventario',
        message: 'El valor del inventario depende de existencias y costo registrado. Si faltan costos, el reporte puede quedar incompleto.',
        tips: [
          'Captura costo de compra en cada producto o lote.',
          'Revisa productos sin costo antes de tomar decisiones de margen.',
          'Separa valor de inventario de ventas: no es dinero disponible.'
        ],
        actions: [
          { label: 'Revisar productos', path: '/productos', icon: '', highlight: true },
          { label: 'Ver reportes', path: '/ventas', icon: '' }
        ]
      };
    },
    
    troubleshoot_stock: () => {
      return {
        title: 'Reparar Inconsistencias de Inventario',
        message: 'Si tus números de stock no cuadran, usa las herramientas de mantenimiento:\n\nOpciones disponibles:\n\n1️⃣ Sincronizar Stock\n   Recalcula todos los stocks basándose en los lotes\n\n2️⃣ Reparar Ganancias\n   Regenera las ganancias desde el historial\n\n',
        tips: [
          '⚠️ Haz un respaldo antes de ejecutar reparaciones',
          '📋 Anota los valores actuales por si necesitas revertir',
          '🔄 El proceso puede tardar unos minutos',
          '✅ Verifica los resultados después de la sincronización'
        ],
        actions: [
          { label: 'Ir a Mantenimiento', path: '/configuracion?tab=maintenance', icon: '', highlight: true }
        ]
      };
    },
    
    unknown: () => {
      const sentiment = analyzeSentiment(entities.originalMessage || '');
      
      let message = 'No estoy seguro de entender tu pregunta.\n\n';
      
      if (sentiment === 'negative') {
        message += 'Veo que algo no está funcionando bien. ';
      }
      
      message += 'Intenta preguntar de esta forma:\n\n';
      message += '• "¿Cuánto vendí hoy?"\n';
      message += '• "¿Qué productos están por agotarse?"\n';
      message += '• "¿Quién me debe dinero?"\n';
      message += '• "Buscar Coca-Cola"\n';
      message += '• "¿Qué se vende más?"';
      
      return {
        title: sentiment === 'negative' ? '¿Necesitas ayuda?' : 'No Entendí Bien',
        message,
        tips: [
          '💡 Sé específico con tu pregunta',
          '📝 Usa palabras clave como "ventas", "stock", "productos"',
          '❓ Pregunta por períodos específicos (hoy, semana, mes)'
        ],
        actions: [
          { label: 'Ayuda de soporte', path: '/acerca-de', icon: '' }
        ]
      };
    }
  };
  
  const handler = responses[intent] || responses.unknown;
  const response = await handler();
  
  // Guardar en memoria conversacional
  conversationMemory.addMessage(entities.originalMessage || '', response);
  
  return response;
};

// ============================================================
// 5. SUGERENCIAS PROACTIVAS
// ============================================================

/**
 * Genera sugerencias basadas en contexto y hora del día
 * @param {Object} options - Opciones de configuración
 * @param {string|null} [options.lastBackupDate] - Fecha del último respaldo (ISO string)
 * @returns {Promise<Object|null>} La sugerencia más importante o null
 */
export const getProactiveSuggestions = async (options = {}) => {
  const { lastBackupDate } = options;
  const suggestions = [];
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  const date = now.getDate();
  
  // Sugerencia: Hacer respaldo (Viernes tarde)
  if (day === 5 && hour >= 16 && hour <= 19) {
    const lastDate = lastBackupDate ? new Date(lastBackupDate) : null;
    
    if (!lastDate || (now - lastDate) > 7 * 24 * 60 * 60 * 1000) {
      suggestions.push({
        type: 'backup',
        priority: 'high',
        message: '💾 Es viernes, ¿ya respaldaste tus datos de la semana?',
        action: { label: 'Respaldar Ahora', path: '/configuracion?tab=maintenance' }
      });
    }
  }
  
  // Sugerencia: Revisar caducidades (Lunes mañana)
  if (day === 1 && hour >= 8 && hour <= 11) {
    const expiring = await getExpiringProducts(7);
    if (expiring.length > 0) {
      suggestions.push({
        type: 'expiration',
        priority: 'high',
        message: `⚠️ Hay ${expiring.length} producto(s) por caducar esta semana`,
        action: { label: 'Ver Lista', path: '/ventas?tab=expiration' }
      });
    }
  }
  
  // Sugerencia: Revisar stock bajo (Inicio de mes)
  if (date >= 1 && date <= 3 && hour >= 9 && hour <= 12) {
    const lowStock = await getLowStockProducts();
    if (lowStock.length >= 5) {
      suggestions.push({
        type: 'restock',
        priority: 'medium',
        message: `📦 ${lowStock.length} productos necesitan reabastecimiento`,
        action: { label: 'Ver Qué Pedir', path: '/ventas?tab=restock' }
      });
    }
  }
  
  // Sugerencia: Revisar deudas (Mitad de mes)
  if (date >= 14 && date <= 16 && hour >= 10 && hour <= 14) {
    const debtors = await getCustomersWithDebt();
    const totalDebt = debtors.reduce((sum, c) => sum + c.debt, 0);
    
    if (totalDebt > 1000) {
      suggestions.push({
        type: 'debt',
        priority: 'medium',
        message: `💳 Tienes $${totalDebt.toFixed(2)} en cuentas por cobrar`,
        action: { label: 'Enviar Recordatorios', path: '/clientes' }
      });
    }
  }
  
  return suggestions.sort((a, b) => {
    const priority = { high: 3, medium: 2, low: 1 };
    return priority[b.priority] - priority[a.priority];
  })[0]; // Retornar solo la más importante
};



