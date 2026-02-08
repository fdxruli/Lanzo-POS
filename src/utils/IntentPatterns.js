// src/utils/intentPatterns.js
/**
 * PATRONES DE INTENCIONES MEJORADOS
 * Sistema expandido con sinónimos y variaciones
 */

// ============================================================
// DICCIONARIO DE SINÓNIMOS
// ============================================================

export const SYNONYMS = {
  vender: ['vendi', 'vendido', 'facturado', 'cobrado', 'ingresado'],
  comprar: ['compre', 'comprado', 'adquirido', 'conseguido'],
  ganar: ['gane', 'ganado', 'ganancia', 'utilidad', 'beneficio', 'profit'],
  deber: ['debe', 'debiendo', 'deuda', 'adeuda', 'pendiente', 'fiado'],
  falta: ['faltan', 'faltando', 'necesito', 'requiero', 'acabando'],
  producto: ['productos', 'item', 'items', 'articulo', 'articulos', 'mercancia'],
  cliente: ['clientes', 'consumidor', 'comprador', 'persona'],
  stock: ['inventario', 'existencias', 'almacen', 'deposito'],
  precio: ['precios', 'costo', 'valor', 'importe']
};

// ============================================================
// PATRONES DE INTENCIÓN EXPANDIDOS
// ============================================================

export const INTENT_PATTERNS = {
  // ========== VENTAS Y REPORTES ==========
  sales_report: {
    patterns: [
      /cuanto.*(?:vendi|vendido|facturado|ingrese)/i,
      /ventas.*(?:hoy|dia|semana|mes|ayer)/i,
      /(?:reporte|informe|resumen).*ventas/i,
      /total.*(?:vendido|facturado)/i,
      /cuantas.*ventas/i,
      /(?:dinero|plata|efectivo).*(?:hice|entre|ingrese)/i,
      /cuanto.*llevo.*vendido/i,
      /ventas del.*(?:dia|mes|ano)/i
    ],
    keywords: ['vent', 'vend', 'factur', 'ingres', 'dinero'],
    examples: [
      "¿Cuánto vendí hoy?",
      "Ventas de la semana",
      "Dame el reporte de ventas del mes",
      "¿Cuánto llevo vendido?"
    ]
  },

  profit_report: {
    patterns: [
      /cuanto.*(?:gane|ganado|utilidad|beneficio)/i,
      /ganancia.*(?:del|de)/i,
      /(?:utilidad|margen|profit)/i,
      /cuanto.*(?:estoy ganando|he ganado)/i,
      /cuanto.*(?:dinero|plata).*(?:gane|hice)/i
    ],
    keywords: ['ganancia', 'utilidad', 'profit', 'margen', 'beneficio'],
    examples: [
      "¿Cuánto gané hoy?",
      "Muéstrame la ganancia del mes",
      "¿Cuál es mi utilidad?"
    ]
  },

  // ========== INVENTARIO Y PRODUCTOS ==========
  low_stock: {
    patterns: [
      /que.*(?:falta|faltando|acabando)/i,
      /productos.*(?:bajo|poco|escaso)/i,
      /que.*(?:pedir|comprar|ordenar)/i,
      /stock.*(?:bajo|poco|minimo)/i,
      /que.*(?:se esta acabando|agotando)/i,
      /necesito.*(?:comprar|pedir)/i,
      /que.*(?:reponer|reabastecer)/i
    ],
    keywords: ['falta', 'poc', 'acaba', 'stock', 'inventari', 'qued'],
    examples: [
      "¿Qué me falta?",
      "Productos con stock bajo",
      "¿Qué necesito comprar?",
      "¿Qué se está acabando?"
    ]
  },

  product_search: {
    patterns: [
      /(?:donde esta|ubicacion).*producto/i,
      /tengo.*(?:producto|item|stock)/i,
      /hay.*(?:producto|existencia)/i,
      /cuanto.*(?:tengo|queda|hay).*de/i,
      /buscar.*producto/i,
      /stock.*de/i,
      /informacion.*producto/i
    ],
    keywords: ['tengo', 'hay', 'donde', 'buscar', 'stock de', 'cuanto'],
    examples: [
      "¿Tengo Coca-Cola?",
      "¿Dónde está el arroz?",
      "Buscar producto Leche",
      "¿Cuánto me queda de azúcar?"
    ]
  },

  expiration_alert: {
    patterns: [
      /(?:que|cuales).*(?:caduca|vence|expira)/i,
      /productos.*(?:vencidos|caducados|expirados)/i,
      /(?:fecha|fechas).*(?:vencimiento|caducidad)/i,
      /(?:por|a punto de).*(?:vencer|caducar)/i,
      /caducidad/i
    ],
    keywords: ['caduca', 'vence', 'caducidad', 'vencimiento', 'expira'],
    examples: [
      "¿Qué productos caducan pronto?",
      "Productos por vencer",
      "¿Qué está a punto de caducar?"
    ]
  },

  // ========== CLIENTES Y CUENTAS ==========
  customer_debt: {
    patterns: [
      /quien.*(?:debe|adeuda)/i,
      /cuanto.*(?:debe|adeuda|pendiente)/i,
      /clientes.*(?:deud|pendiente|fiado)/i,
      /(?:cobrar|recuperar).*pendiente/i,
      /(?:cuenta|cuentas).*cobrar/i,
      /fiado/i,
      /credito/i
    ],
    keywords: ['debe', 'deuda', 'fiado', 'pendiente', 'cobrar', 'credito'],
    examples: [
      "¿Quién me debe?",
      "Clientes con deuda",
      "¿Cuánto me deben?",
      "Cuentas por cobrar"
    ]
  },

  customer_search: {
    patterns: [
      /buscar.*cliente/i,
      /informacion.*cliente/i,
      /datos.*(?:de|del).*cliente/i,
      /historial.*cliente/i,
      /cliente.*(?:llama|nombre)/i
    ],
    keywords: ['cliente', 'buscar', 'informacion', 'historial'],
    examples: [
      "Buscar cliente Juan",
      "Información del cliente",
      "Historial de Juan Pérez"
    ]
  },

  best_customers: {
    patterns: [
      /(?:mejores|mejores).*clientes/i,
      /clientes.*(?:frecuentes|fieles|leales)/i,
      /quien.*(?:compra|viene).*mas/i,
      /top.*clientes/i
    ],
    keywords: ['mejores', 'top', 'frecuentes', 'fieles'],
    examples: [
      "¿Quiénes son mis mejores clientes?",
      "Clientes más frecuentes",
      "Top clientes del mes"
    ]
  },

  // ========== AYUDA Y TUTORIALES ==========
  help_general: {
    patterns: [
      /(?:como|de que manera).*(?:uso|funciona)/i,
      /ayuda/i,
      /no.*se.*(?:como|que)/i,
      /que.*puedo.*hacer/i,
      /tutorial/i,
      /guia/i,
      /instrucciones/i
    ],
    keywords: ['ayuda', 'como', 'tutorial', 'guia', 'instrucciones'],
    examples: [
      "¿Cómo funciona esto?",
      "Ayuda general",
      "¿Qué puedo hacer?",
      "Tutorial del sistema"
    ]
  },

  help_product: {
    patterns: [
      /como.*(?:agregar|anadir|crear).*producto/i,
      /(?:agregar|anadir).*producto/i,
      /registrar.*producto/i,
      /nuevo.*producto/i,
      /alta.*producto/i
    ],
    keywords: ['agregar', 'crear', 'nuevo', 'producto', 'registrar'],
    examples: [
      "¿Cómo agregar un producto?",
      "Crear nuevo producto",
      "Tutorial para añadir productos"
    ]
  },

  help_sale: {
    patterns: [
      /como.*(?:vender|hacer.*venta)/i,
      /procesar.*venta/i,
      /hacer.*venta/i,
      /cobrar.*cliente/i,
      /tutorial.*venta/i
    ],
    keywords: ['vender', 'venta', 'cobrar', 'procesar'],
    examples: [
      "¿Cómo hacer una venta?",
      "Tutorial de ventas",
      "¿Cómo cobrar?"
    ]
  },

  help_inventory: {
    patterns: [
      /como.*(?:agregar|actualizar).*stock/i,
      /(?:manejar|gestionar).*inventario/i,
      /actualizar.*existencias/i,
      /control.*inventario/i
    ],
    keywords: ['stock', 'inventario', 'agregar', 'actualizar'],
    examples: [
      "¿Cómo agregar stock?",
      "Gestionar inventario",
      "Actualizar existencias"
    ]
  },

  // ========== ANÁLISIS DE NEGOCIO ==========
  best_sellers: {
    patterns: [
      /(?:que|cuales).*(?:vende|venden).*mas/i,
      /productos.*(?:populares|exitosos)/i,
      /(?:mas|mas).*vendido/i,
      /top.*productos/i,
      /(?:lideres|lideres).*ventas/i
    ],
    keywords: ['mas vendido', 'populares', 'top', 'exitosos', 'lideres'],
    examples: [
      "¿Qué se vende más?",
      "Productos más populares",
      "Top 10 productos",
      "¿Cuál es el más vendido?"
    ]
  },

  slow_movers: {
    patterns: [
      /(?:que|cuales).*no.*(?:vende|rota)/i,
      /productos.*(?:lentos|estancados)/i,
      /que.*(?:eliminar|quitar|dar de baja)/i,
      /baja.*rotacion/i,
      /productos.*muertos/i
    ],
    keywords: ['no vende', 'lentos', 'baja rotacion', 'estancados'],
    examples: [
      "¿Qué no se vende?",
      "Productos de baja rotación",
      "¿Qué debería eliminar?"
    ]
  },

  trend_analysis: {
    patterns: [
      /(?:tendencia|tendencias)/i,
      /(?:comparar|comparacion).*ventas/i,
      /(?:como van|como estan).*ventas/i,
      /(?:sube|subi|subido|baja|bajo).*ventas/i
    ],
    keywords: ['tendencia', 'comparar', 'analisis'],
    examples: [
      "Tendencias de venta",
      "Comparar ventas del mes",
      "¿Cómo van las ventas?"
    ]
  },

  projection: {
    patterns: [
      /(?:proyeccion|proyecciones)/i,
      /cuanto.*(?:voy a|vendre)/i,
      /(?:estimado|estimacion).*ventas/i,
      /pronostico/i
    ],
    keywords: ['proyeccion', 'estimado', 'pronostico'],
    examples: [
      "Proyección de ventas",
      "¿Cuánto voy a vender?",
      "Estimado del mes"
    ]
  },

  inventory_value: {
    patterns: [
      /valor.*inventario/i,
      /cuanto.*(?:vale|cuesta).*inventario/i,
      /capital.*(?:invertido|inventario)/i,
      /activo.*inventario/i
    ],
    keywords: ['valor', 'inventario', 'capital', 'invertido'],
    examples: [
      "¿Cuánto vale mi inventario?",
      "Valor del stock",
      "Capital invertido en productos"
    ]
  },

  // ========== CONFIGURACIÓN Y MANTENIMIENTO ==========
  backup_help: {
    patterns: [
      /como.*(?:respaldar|backup)/i,
      /(?:guardar|exportar).*datos/i,
      /copia.*seguridad/i,
      /respaldo/i
    ],
    keywords: ['respaldar', 'backup', 'exportar', 'respaldo'],
    examples: [
      "¿Cómo respaldar mis datos?",
      "Hacer backup",
      "Exportar información"
    ]
  },

  troubleshoot_stock: {
    patterns: [
      /stock.*(?:incorrecto|mal|erroneo)/i,
      /inventario.*(?:mal|incorrecto)/i,
      /(?:numeros|datos).*no.*cuadran/i,
      /(?:desincronizado|desajustado)/i,
      /(?:reparar|arreglar|corregir).*(?:stock|inventario)/i
    ],
    keywords: ['incorrecto', 'mal', 'reparar', 'corregir', 'cuadran'],
    examples: [
      "El stock está mal",
      "Los números no cuadran",
      "Reparar inventario"
    ]
  },

  sync_data: {
    patterns: [
      /sincronizar/i,
      /actualizar.*datos/i,
      /refrescar.*informacion/i,
      /recargar/i
    ],
    keywords: ['sincronizar', 'actualizar', 'refrescar', 'recargar'],
    examples: [
      "Sincronizar datos",
      "Actualizar información",
      "Refrescar todo"
    ]
  },

  change_settings: {
    patterns: [
      /(?:cambiar|modificar).*configuracion/i,
      /(?:ajustar|ajustes)/i,
      /preferencias/i,
      /opciones.*sistema/i
    ],
    keywords: ['configuracion', 'ajustes', 'preferencias', 'opciones'],
    examples: [
      "Cambiar configuración",
      "Ajustes del sistema",
      "Modificar preferencias"
    ]
  },

  // ========== OPERACIONES RÁPIDAS ==========
  quick_sale: {
    patterns: [
      /venta.*rapida/i,
      /cobrar.*(?:rapido|ya)/i,
      /vender.*(?:ahora|rapido)/i
    ],
    keywords: ['venta rapida', 'cobrar rapido'],
    examples: [
      "Venta rápida",
      "Cobrar ya",
      "Vender ahora"
    ]
  },

  add_stock: {
    patterns: [
      /(?:agregar|anadir|ingresar).*stock/i,
      /(?:recibir|recepcion).*mercancia/i,
      /entrada.*productos/i,
      /nueva.*compra/i
    ],
    keywords: ['agregar stock', 'entrada', 'recibir', 'compra'],
    examples: [
      "Agregar stock",
      "Registrar nueva compra",
      "Entrada de mercancía"
    ]
  },

  system_status: {
    patterns: [
      /(?:estado|status).*sistema/i,
      /como.*(?:esta|funciona).*sistema/i,
      /(?:salud|diagnostico).*sistema/i,
      /todo.*(?:bien|correcto|ok)/i
    ],
    keywords: ['estado', 'sistema', 'status', 'salud'],
    examples: [
      "¿Cómo está el sistema?",
      "Estado del sistema",
      "¿Todo está bien?"
    ]
  }
};

// ============================================================
// CONTEXTO CONVERSACIONAL
// ============================================================

export const CONVERSATION_CONTEXT = {
  greeting: {
    patterns: [
      /^(hola|buenos dias|buenas tardes|buenas noches|que tal|hey|ey)$/i
    ],
    responses: [
      "¡Hola! ¿En qué puedo ayudarte hoy?",
      "¡Hola! Estoy aquí para ayudarte con tu negocio.",
      "¡Buen día! ¿Qué necesitas saber?"
    ]
  },
  
  farewell: {
    patterns: [
      /^(adios|chao|hasta luego|nos vemos|bye|gracias)$/i
    ],
    responses: [
      "¡Hasta pronto! Estoy aquí cuando me necesites.",
      "¡Adiós! Que tengas un excelente día.",
      "¡Nos vemos! No dudes en consultarme cuando quieras."
    ]
  },
  
  thanks: {
    patterns: [
      /^(gracias|muchas gracias|te lo agradezco|excelente|perfecto|bien)$/i
    ],
    responses: [
      "¡De nada! Para eso estoy aquí.",
      "¡Es un placer ayudarte!",
      "¡Siempre a tu servicio!"
    ]
  }
};