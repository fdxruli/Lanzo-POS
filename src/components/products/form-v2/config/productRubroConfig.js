import { CANONICAL_BUSINESS_TYPES, normalizeBusinessType } from '../../../../utils/businessType';

export const PRODUCT_RUBRO_CONFIG = {
  [CANONICAL_BUSINESS_TYPES.ABARROTES]: {
    label: 'Abarrotes', detailTitle: 'Forma de venta y abastecimiento', supports: { alerts: true, expiry: true, conversion: true, variants: false }, defaultSaleType: 'unit'
  },
  [CANONICAL_BUSINESS_TYPES.HARDWARE]: {
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
    label: 'Restaurante', detailTitle: 'Preparación y venta', supports: { alerts: false, expiry: true, conversion: false, variants: false }, defaultSaleType: 'unit'
  },
  [CANONICAL_BUSINESS_TYPES.OTRO]: {
    label: 'General', detailTitle: 'Detalles del producto', supports: { alerts: false, expiry: true, conversion: false, variants: false }, defaultSaleType: 'unit'
  }
};

export const getProductRubroConfig = (rubro) => PRODUCT_RUBRO_CONFIG[normalizeBusinessType(rubro)] || PRODUCT_RUBRO_CONFIG[CANONICAL_BUSINESS_TYPES.OTRO];

export const normalizeProductRubro = (rubro) => normalizeBusinessType(rubro);
