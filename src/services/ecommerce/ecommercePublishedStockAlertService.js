import { getEcommercePortal, listPublishedProducts } from './ecommerceAdminService';
import {
  createEcommercePublishedStockAlertService as createCoreService,
  getEcommercePublishedStockAlertContextKey,
  ecommercePublishedStockAlertServiceInternals
} from './ecommercePublishedStockAlertCore';

export { getEcommercePublishedStockAlertContextKey, ecommercePublishedStockAlertServiceInternals };

export const createEcommercePublishedStockAlertService = (options = {}) => createCoreService({
  getPortal: getEcommercePortal,
  getPublishedProducts: listPublishedProducts,
  ...options
});
