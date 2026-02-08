// src/config/botContextByRubro.js

/**
 * CONTEXTOS INTELIGENTES POR RUBRO
 * Cada rubro tiene mensajes, tips y acciones específicas según la página
 */

// ====================================================================
// FOOD SERVICE (Restaurantes, Cafeterías, Fondas)
// ====================================================================
export const foodServiceContext = {
  pos: {
    default: {
      title: "Punto de Venta - Restaurante",
      message: "Listo para tomar pedidos. Escanea o busca platillos.",
      tips: [
        "Usa el KDS (Cocina) para ver pedidos en tiempo real",
        "Recuerda actualizar el menú si hay platillos agotados"
      ],
      actions: [
        { label: "Ver Cocina (KDS)", path: "/pedidos", icon: "" },
        { label: "Revisar Menú", path: "/productos", icon: "" },
        { label: "Ver Ingredientes", path: "/productos?tab=ingredients", icon: "" },
        { label: "Crear Platillo", path: "/productos?tab=add", icon: "" }
      ]
    }
  },
  
  productos: {
    default: {
      title: "Gestión de Menú",
      message: "Administra tu carta digital y recetas.",
      tips: [
        "Define recetas para controlar costos de insumos",
        "Marca ingredientes perecederos con caducidad"
      ],
      actions: [
        { label: "Ver clientes", path: "/clientes", icon: "" },
        { label: "Ir a configuracion", path: "/configuracion", icon: "" }
      ]
    },
    lowStock: {
      title: "⚠️ Ingredientes Bajos",
      message: (data) => `${data.lowStockCount} ingrediente${data.lowStockCount > 1 ? 's necesitan' : ' necesita'} reabastecimiento`,
      tips: [
        "Ve a 'Ingredientes' para ver detalles",
        "Genera orden de compra desde Dashboard"
      ]
    }
  },

  pedidos: {
    default: {
      title: "🍽️ Sistema de Cocina (KDS)",
      message: "Comandas en tiempo real",
      tips: [
        "Prioriza pedidos según hora de llegada",
        "Marca 'Listo' cuando termine el platillo y confirma 'Entregado' para terminar el pedido"
      ],
      actions: []
    }
  }
};

// ====================================================================
// FARMACIA
// ====================================================================
export const pharmacyContext = {
  pos: {
    default: {
      title: "Dispensario Farmacéutico",
      message: "Caja lista para dispensar medicamentos.",
      tips: [
        "Verifica caducidades antes de vender",
        "Productos controlados requieren receta médica. el sistema te lo pedira si configuraste el medicamento"
      ],
      actions: [
        { label: "Verificar Caducidades", path: "/ventas?tab=expiration", icon: "" },
        { label: "Ver Inventario", path: "/productos", icon: "" }
      ]
    },
    withCart: {
      title: "Dispensando Medicamentos",
      message: (data) => `${data.cartCount} producto${data.cartCount > 1 ? 's' : ''} | Total: $${data.cartTotal.toFixed(2)}`,
      tips: [
        "⚠️ Verifica si algún producto requiere receta",
        "Revisa fecha de caducidad antes de cobrar"
      ]
    }
  },

  productos: {
    default: {
      title: "Gestión Farmacéutica",
      message: "Control de inventario y caducidades.",
      tips: [
        "Configura lotes con caducidad (Normativa COFEPRIS)",
        "Marca controlados para exigir receta automáticamente"
      ],
      actions: [
        { label: "Productos por Caducar", path: "/ventas?tab=expiration", icon: "" },
        { label: "Gestionar Lotes", path: "/productos?tab=batches", icon: "" }
      ]
    }
  }
};

// ====================================================================
// VERDULERÍA / FRUTERÍA
// ====================================================================
export const fruiteriaContext = {
  pos: {
    default: {
      title: "Punto de Venta - Frutas y Verduras",
      message: "Caja lista. Productos frescos del día.",
      tips: [
        "Productos a granel: Registra peso exacto",
        "Actualiza precios del día si hay cambios"
      ],
      actions: [
        { label: "Actualizar Precios", path: "/productos", icon: "", highlight: true },
        { label: "Ver Mermas", path: "/ventas?tab=waste", icon: "" }
      ]
    }
  },

  productos: {
    default: {
      title: "Gestión de Productos Frescos",
      message: "Control de perecederos y precios variables.",
      tips: [
        "Configura unidad de compra vs venta (kg/ton)",
        "Actualiza precios según mercado diariamente"
      ],
      actions: [
        { label: "Precios del Día", path: "/productos?daily=true", icon: "", highlight: true }
      ]
    }
  }
};

// ====================================================================
// ROPA / CALZADO (APPAREL)
// ====================================================================
export const apparelContext = {
  pos: {
    default: {
      title: "Boutique - Punto de Venta",
      message: "Caja lista. Escanea etiquetas o busca por SKU.",
      tips: [
        "Escanea etiquetas para control exacto de tallas/colores",
        "Ofrece apartados si el cliente duda"
      ],
      actions: [
        { label: "Inventario por Talla", path: "/productos?tab=variants", icon: "" },
        { label: "Crear Apartado", path: "/clientes", icon: "" }
      ]
    }
  },

  productos: {
    default: {
      title: "Gestión de Inventario - Moda",
      message: "Control de variantes y SKU.",
      tips: [
        "Usa variantes para control exacto de tallas/colores.",
        "Configura SKU únicos por prenda,",
        "Ofrece sistema de apartado para asegurar ventas grandes."
      ],
      actions: [
        { label: "Ir a clientes", path: "/clientes", icon: "" },
        //{ label: "Ver Apartados", path: "/clientes?tab=layaway", icon: "" }
      ]
    }
  }
};

// ====================================================================
// FERRETERÍA (HARDWARE)
// ====================================================================
export const hardwareContext = {
  pos: {
    default: {
      title: "Ferretería - Mostrador",
      message: "Caja lista para venta de materiales.",
      tips: [
        "Productos a granel: Verifica unidad (metro/kilo)",
        "Mayoreo automático para constructores"
      ],
      actions: [
        { label: "Reabastecer", path: "/ventas?tab=restock", icon: "" }
      ]
    }
  }
};

// ====================================================================
// ABARROTES (GENÉRICO)
// ====================================================================
export const abarrotesContext = {
  pos: {
    default: {
      title: "Punto de Venta - Abarrotes",
      message: "Caja lista. Escanea productos o usa el buscador.",
      tips: [
        "Usa el escáner para productos empaquetados",
        "Productos a granel: Registra peso exacto"
      ],
      actions: [
        { label: "Ver Stock Bajo", path: "/ventas?tab=restock", icon: "" }
      ]
    }
  }
};

// ====================================================================
// MAPEO MAESTRO (Exportación)
// ====================================================================
export const RUBRO_CONTEXTS = {
  'food_service': foodServiceContext,
  'farmacia': pharmacyContext,
  'verduleria/fruteria': fruiteriaContext,
  'apparel': apparelContext,
  'hardware': hardwareContext,
  'abarrotes': abarrotesContext
};