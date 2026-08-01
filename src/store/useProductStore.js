// Alias transitorio para consumidores administrativos. El POS no puede importarlo.
export { useInventoryCatalogStore as useProductStore } from './useInventoryCatalogStore';
export { broadcastDBChange } from '../services/products/productCatalogEvents';
