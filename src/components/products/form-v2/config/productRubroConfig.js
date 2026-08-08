import { CANONICAL_BUSINESS_TYPES, normalizeBusinessType } from '../../../../utils/businessType';

export const PRODUCT_RUBRO_CONFIG = {
  [CANONICAL_BUSINESS_TYPES.ABARROTES]: {
    label: 'Abarrotes', detailTitle: 'Forma de venta y abastecimiento', supports: { alerts: true, expiry: true, conversion: true, variants: false }, defaultSaleType: 'unit',
    productTypeOptions: [
      { value: 'unit', label: 'Unidad', description: 'Vendes una pieza o unidad.' },
      { value: 'bulk', label: 'A granel', description: 'Vendes por peso, volumen o medida.' },
      { value: 'fractioned', label: 'Fraccionado', description: 'Compras una presentación y vendes unidades menores.' }
    ]
  },
  [CANONICAL_BUSINESS_TYPES.HARDWARE]: {
    productTypeOptions: [
      { value: 'unit', label: 'Por pieza', description: 'Vendes una pieza o unidad completa.' },
      { value: 'bulk', label: 'Por medida o peso', description: 'Vendes por metro, peso, volumen u otra medida.' },
      { value: 'fractioned', label: 'Fraccionado', description: 'Compras una presentación y vendes unidades menores.' }
    ],
    label: 'Ferretería', detailTitle: 'Medidas, venta y abastecimiento', supports: { alerts: true, expiry: true, conversion: true, variants: false }, defaultSaleType: 'unit'
  },
  [CANONICAL_BUSINESS_TYPES.VERDULERIA_FRUTERIA]: {
    label: 'Verdulería y frutería', detailTitle: 'Venta y duración del producto', supports: { alerts: false, expiry: true, conversion: false, variants: false }, defaultSaleType: 'bulk'
  },
  [CANONICAL_BUSINESS_TYPES.APPAREL]: {
    label: 'Ropa y accesorios', detailTitle: 'Tallas, colores y variantes', supports: { alerts: false, expiry: false, conversion: false, variants: true }, defaultSaleType: 'unit'
  },
  [CANONICAL_BUSINESS_TYPES.FARMACIA]: {
    label: 'Farmacia', detailTitle: 'Datos farmacéuticos', supports: { alerts: false, expiry: true, conversion: false, variants: false }, defaultSaleType: 'unit', strictExpiry: true
  },
  [CANONICAL_BUSINESS_TYPES.FOOD_SERVICE]: {
    label: 'Restaurante', detailTitle: 'Preparación y venta', supports: { alerts: false, expiry: true, conversion: false, variants: false }, defaultSaleType: 'unit',
    productTypeOptions: [
      { value: 'dish', label: 'Platillo', description: 'Se prepara y puede llevar receta.' },
      { value: 'drink', label: 'Bebida', description: 'Producto listo para vender.' },
      { value: 'ready', label: 'Producto listo', description: 'Se vende sin preparación.' },
      { value: 'ingredient', label: 'Insumo', description: 'Material para inventario y recetas.' }
    ]
  },
  [CANONICAL_BUSINESS_TYPES.OTRO]: {
    label: 'General', detailTitle: 'Detalles del producto', supports: { alerts: false, expiry: true, conversion: false, variants: false }, defaultSaleType: 'unit'
  }
};

export const getProductRubroConfig = (rubro) => PRODUCT_RUBRO_CONFIG[normalizeBusinessType(rubro)] || PRODUCT_RUBRO_CONFIG[CANONICAL_BUSINESS_TYPES.OTRO];

export const normalizeProductRubro = (rubro) => normalizeBusinessType(rubro);
