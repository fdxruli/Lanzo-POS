// Configuración de contextos del bot según la ruta actual
import { RUBRO_CONTEXTS, abarrotesContext } from './botContextByRubro'


const getPageKey = (pathname) => {
  if (pathname === '/' || pathname.startsWith('/pos')) return 'pos';
  if (pathname.startsWith('/productos')) return 'productos';
  if (pathname.startsWith('/ventas')) return 'ventas'; // O dashboard
  if (pathname.startsWith('/pedidos')) return 'pedidos';
  return 'default';
};

// 1. Definir la Alerta Global que falta
export const GLOBAL_ALERT = {
  active: true, // Cambiar a true si hay un mensaje urgente
  id: 'actualizaciones_03',
  message: 'El sistema a tenido una actualizacion considerable. Si notas algo raro ve a Datos y Mantenimiento en la seccion de configuracion para sincronizar tus ventas y stock de productos. Y si tienes problemas con el sistema por favor reporta a soporte ;)',
  actionLink: '/configuracion?tab=maintenance'
};

// 2. Función para obtener acciones rápidas (solicitada por AssistantBot)
export const getQuickActions = (pathname, rubroType = 'abarrotes') => {
  // Intentar buscar en la config específica
  const rubroConfig = RUBRO_CONTEXTS[rubroType] || RUBRO_CONTEXTS['abarrotes'];
  const pageKey = getPageKey(pathname);

  if (rubroConfig[pageKey]?.default?.actions) {
    return rubroConfig[pageKey].default.actions;
  }

  // Fallback genérico
  return [
    { label: 'Productos', path: '/productos', icon: '' },
    { label: 'Caja', path: '/caja', icon: '' },
    { label: 'Clientes', path: '/clientes', icon: '' },
    { label: 'Reportes', path: '/ventas', icon: '' }
  ];
};

/**
 * Define el contexto y acciones rápidas del asistente según la página actual
 * @param {string} pathname - Ruta actual de la aplicación
 * @param {object} data - Datos contextuales (carrito, productos, stats, etc.)
 * @returns {object} - Configuración de contexto para el asistente
 */
export const getBotContext = (pathname, data = {}) => {
  const { cart = [], stats = {}, businessType = [] } = data;

  // 1. Identificar el rubro del negocio (asume que businessType es un array, tomamos el primero)
  // Normalizamos el string para que coincida con las claves de RUBRO_CONTEXTS
  const currentRubro = businessType.length > 0 ? businessType[0].toLowerCase() : 'abarrotes';

  // 2. Obtener la configuración del rubro o usar abarrotes por defecto
  const contextConfig = RUBRO_CONTEXTS[currentRubro] || RUBRO_CONTEXTS['abarrotes'] || abarrotesContext;

  // 3. Identificar la página actual
  const pageKey = getPageKey(pathname);

  // 4. Buscar configuración específica para esta página
  const pageConfig = contextConfig[pageKey];

  if (pageConfig) {
    // Lógica para estados específicos (ej. "withCart" si hay cosas en el carrito)
    if (pageKey === 'pos' && cart.length > 0 && pageConfig.withCart) {
      const stateConfig = pageConfig.withCart;
      return {
        ...stateConfig,
        // Si el mensaje es una función, la ejecutamos con data
        message: typeof stateConfig.message === 'function' ? stateConfig.message(data) : stateConfig.message
      };
    }

    // Estado por defecto de la página específica del rubro
    if (pageConfig.default) {
      const stateConfig = pageConfig.default;
      return {
        ...stateConfig,
        message: typeof stateConfig.message === 'function' ? stateConfig.message(data) : stateConfig.message
      };
    }
  }

  // 🏠 PÁGINA PRINCIPAL / PUNTO DE VENTA
  if (pathname === '/' || pathname.startsWith('/pos')) {
    const itemsCount = cart.length;
    const hasItems = itemsCount > 0;

    return {
      message: hasItems
        ? `Tienes ${itemsCount} producto${itemsCount > 1 ? 's' : ''} en el carrito. ¿Necesitas ayuda para finalizar la venta o aplicar descuentos?`
        : 'Estás en el punto de venta. Puedo ayudarte a agregar productos, gestionar el carrito o realizar una venta.',
      actions: [
        {
          label: 'Agregar producto',
          icon: '',
          path: '/productos',
          highlight: false
        },
        {
          label: 'Ver clientes',
          icon: '',
          path: '/clientes',
          highlight: false
        },
        {
          label: 'Ver corte de caja',
          icon: '',
          path: '/caja',
          highlight: false
        },
        {
          label: 'Ver estadísticas',
          icon: '',
          path: '/ventas',
          highlight: false
        }
      ],
      tips: [
        'Usa el escáner de código de barras para agregar productos rápidamente',
      ]
    };
  }

  // 👥 CLIENTES
  if (pathname.startsWith('/clientes')) {
    const totalDebt = stats.totalDebt || 0;
    const hasDebt = totalDebt > 0;

    return {
      message: hasDebt
        ? `Hay cuentas pendientes por cobrar por un total de $${totalDebt.toFixed(2)}. ¿Quieres ver el resumen de deudas?`
        : 'Gestiona tus clientes y sus cuentas. Puedo ayudarte a registrar nuevos clientes o revisar cuentas pendientes.',
      actions: [
        {
          label: 'Ver caja',
          icon: '',
          path: '/caja',
          highlight: false
        },
        {
          label: 'Historial de ventas',
          icon: '',
          path: '/ventas?tab=history',
          highlight: false
        }
      ],
      tips: [
        'Establece límites de crédito para cada cliente',
        'Envía recordatorios de pago',
        'Ofrece descuentos por pronto pago'
      ]
    };
  }

  // ⚙️ CONFIGURACIÓN
  if (pathname.startsWith('/configuracion')) {
    return {
      message: 'Configura tu sistema según las necesidades de tu negocio. ¿Necesitas ayuda con alguna configuración específica?',
      actions: [
        {
          label: 'Agregar producto',
          icon: '',
          path: '/productos?tab=add',
          highlight: false
        },
        {
          label: 'Caja',
          icon: '',
          path: '/caja',
          highlight: false
        },
        {
          label: 'Ver Clientes',
          icon: '',
          path: '/clientes',
          highlight: false
        },
        {
          label: 'Acerca de',
          icon: '',
          path: '/acerca-de',
          highlight: false
        }
      ],
      tips: [
        'Agrega informacion de tu negocio para brindarte servicio mas personalizado.',
        'Si quieres cambiar informacion de nu negocio contacta a soporte en la seccion de Acerca de',
        'Realiza respaldo de tu negocio en Datos y Mantenimiento en el boton de "Respaldo y Datos".'
      ]
    };
  }

  // 📊 DASHBOARD
  if (pathname.startsWith('/ventas')) {
    const topProduct = stats.topProduct || 'N/A';

    return {
      message: `Aquí puedes ver un resumen completo de tu negocio. El producto más vendido es: ${topProduct}.`,
      actions: [
        {
          label: 'Agrega productos',
          icon: '',
          path: '/productos?tab=add',
          highlight: false
        },
        {
          label: 'Ver estado de caja',
          icon: '',
          path: '/caja',
          highlight: false
        },
        {
          label: 'Mantenimiento',
          icon: '',
          path: '/configuracion?tab=maintenance',
          highlight: false
        }
      ],
      tips: [
        'Revisa el dashboard para ver tendencias de ventas',
        'Recive consejos de nuestro BOT. Aprendera de tus datos y te dara consejos utiles. (Aun es experimental)',
      ]
    };
  }

  // 🛒 productos
  if (pathname.startsWith('/productos')) {
    return {
      message: 'Gestiona el inventario de tus productos. Puedo ayudarte a agregar nuevos productos, actualizar existencias o revisar productos con bajo stock.',
      actions: [
        {
          label: 'ir a reportes de ventas',
          icon: '',
          path: '/ventas',
          highlight: false
        },
        {
          label: 'ir a configuracion',
          icon: '',
          path: '/configuracion',
          highlight: false
        }
      ],
      tips: [
        'Asegurate de revisar productos con bajo stock regularmente.',
        'Agrega el costo de compra y costo de venta para que tengas metricas mas exactas de tu negocio.',
        'Para agregar stock a un producto ve a Gestionar de lotes.'
      ]
    };
  }

  // 🎯 CONTEXTO GENÉRICO (FALLBACK)
  return {
    message: '¡Hola! Soy tu asistente virtual. Estoy aquí para ayudarte con cualquier duda sobre el sistema. ¿En qué puedo asistirte?',
    actions: [
      {
        label: ' Ir a punto de venta',
        icon: '',
        path: '/',
        highlight: false
      },
      {
        label: ' Ver inventario',
        icon: '',
        path: '/productos',
        highlight: false
      },
      {
        label: ' Ver clientes',
        icon: '',
        path: '/clientes',
        highlight: false
      },
      {
        label: ' Ver reportes',
        icon: '',
        path: '/ventas',
        highlight: false
      }
    ],
    tips: [
      'Puedes cambiar entre modo claro/oscuro en configuración'
    ]
  };
};

/**
 * Detecta alertas críticas que deben mostrarse con prioridad
 * @param {object} data - Datos del sistema
 * @returns {object|null} - Alerta crítica o null
 */
export const getCriticalAlert = (data = {}) => {
  const { stats = {}, license = {}, products = [] } = data;

  // 1. Licencia próxima a vencer (menos de 7 días)
  if (license.daysRemaining && license.daysRemaining <= 7) {
    return {
      type: 'license',
      severity: license.daysRemaining <= 3 ? 'critical' : 'warning',
      message: `Tu licencia vence en ${license.daysRemaining} día${license.daysRemaining > 1 ? 's' : ''}. Renueva ahora para evitar interrupciones. No te preocupes puedes hacerlo totalmente gratis`,
      action: {
        label: 'Renovar licencia',
        route: '/renovacion-urgente'
      }
    };
  }

  /* 2. Muchos productos con stock bajo (más de 10)
  const lowStockProducts = products.filter(p => p.stock < 10);
  if (lowStockProducts.length > 10) {
    return {
      type: 'inventory',
      severity: 'warning',
      message: `Tienes ${lowStockProducts.length} productos con stock bajo. Es momento de hacer pedidos a tus proveedores.`,
      action: {
        label: 'Ver productos',
        route: '/productos'
      }
    };
  }*/

  /* 3. Deudas muy altas (más de $10,000)
  if (stats.totalDebt && stats.totalDebt > 10000) {
    return {
      type: 'debt',
      severity: 'warning',
      message: `💳 Tienes cuentas por cobrar por $${stats.totalDebt.toFixed(2)}. Considera hacer recordatorios de pago.`,
      action: {
        label: 'Ver deudas',
        route: '/customers/debts'
      }
    };
  }*/

  // 4. No se ha hecho backup recientemente (más de 7 días)
  if (stats.lastBackupDays && stats.lastBackupDays > 7) {
    return {
      type: 'backup',
      severity: 'critical',
      message: ` No has hecho un backup en ${stats.lastBackupDays} días. Es importante respaldar tu información regularmente.`,
      action: {
        label: 'Hacer backup',
        path: '/configuracion?tab=maintenance'
      }
    };
  }

  // 5. Diferencias en caja (si el efectivo reportado no coincide)
  if (stats.cashDifference && Math.abs(stats.cashDifference) > 100) {
    return {
      type: 'cash',
      severity: 'critical',
      message: `Hay una diferencia de $${Math.abs(stats.cashDifference).toFixed(2)} en caja. Revisa el corte de caja urgentemente.`,
      action: {
        label: 'Ver corte de caja',
        path: '/caja'
      }
    };
  }

  return null;
};

/**
 * Genera sugerencias inteligentes basadas en el contexto actual
 * @param {object} data - Datos del sistema
 * @returns {array} - Lista de sugerencias
 */
export const getSmartSuggestions = (data = {}) => {
  const { stats = {}, products = [], timeOfDay = 'morning' } = data;
  const suggestions = [];

  // Sugerencia basada en hora del día
  if (timeOfDay === 'morning') {
    suggestions.push({
      icon: '☀️',
      text: 'Buenos días. Revisa el reporte de ventas de ayer para planificar el día.',
      action: { label: 'Ver reporte', route: '/reports/sales' }
    });
  } else if (timeOfDay === 'evening') {
    suggestions.push({
      icon: '🌙',
      text: 'Es hora de hacer el corte de caja y cerrar el día.',
      action: { label: 'Corte de caja', route: '/reports/cash-close' }
    });
  }

  // Sugerencia de productos de alta rotación
  if (stats.topProducts && stats.topProducts.length > 0) {
    const topProduct = stats.topProducts[0];
    suggestions.push({
      icon: '⭐',
      text: `Tu producto estrella es "${topProduct.name}". Asegúrate de tener suficiente stock.`,
      action: { label: 'Ver inventario', route: '/inventory' }
    });
  }

  // Sugerencia de análisis de rentabilidad
  if (stats.lowMarginProducts && stats.lowMarginProducts > 0) {
    suggestions.push({
      icon: '📉',
      text: `Tienes ${stats.lowMarginProducts} productos con margen bajo. Considera ajustar precios.`,
      action: { label: 'Revisar precios', route: '/inventory' }
    });
  }

  return suggestions;
};

export const getSmartContext = getBotContext;

export default {
  getBotContext,
  getCriticalAlert,
  getSmartSuggestions
};