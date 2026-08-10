/**
 * @param {{ hasVariants?: boolean, hasLots?: boolean }} features
 * @param {{ isCommercialVariant?: boolean }} options
 * @returns {Array<{ key: string, label: string }>}
 */
export function getBatchTableColumns(features = {}, options = {}) {
  const columns = [
    { key: 'primary', label: features.hasVariants ? 'Variante' : 'Fecha' }
  ];

  if (features.hasVariants) {
    columns.push({ key: 'sku', label: 'SKU' });
  }

  if (features.hasLots || features.hasExpiry) {
    columns.push({ key: 'expiryDate', label: 'Caducidad' });
  }

  columns.push({
    key: 'price',
    label: options.isCommercialVariant ? 'Precio de variante' : 'Precio del producto'
  });
  columns.push({ key: 'supplier', label: 'Proveedor' });
  columns.push({ key: 'location', label: 'Ubicacion' });
  columns.push({ key: 'stock', label: 'Stock' });
  columns.push({ key: 'actions', label: 'Accion' });

  return columns;
}
