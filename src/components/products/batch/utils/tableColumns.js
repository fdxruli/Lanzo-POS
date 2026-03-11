/**
 * @param {{ hasVariants?: boolean, hasLots?: boolean }} features
 * @returns {Array<{ key: string, label: string }>}
 */
export function getBatchTableColumns(features = {}) {
  const columns = [
    { key: 'primary', label: features.hasVariants ? 'Variante' : 'Fecha' }
  ];

  if (features.hasVariants) {
    columns.push({ key: 'sku', label: 'SKU' });
  }

  if (features.hasLots) {
    columns.push({ key: 'expiryDate', label: 'Caducidad' });
  }

  columns.push({ key: 'price', label: 'Precio' });
  columns.push({ key: 'supplier', label: 'Proveedor' });
  columns.push({ key: 'location', label: 'Ubicacion' });
  columns.push({ key: 'stock', label: 'Stock' });
  columns.push({ key: 'actions', label: 'Accion' });

  return columns;
}