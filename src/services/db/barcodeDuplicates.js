import { normalizeBarcodeKey } from '../products/productMapper';

// The tenant runtime supplies the already-isolated MENU table. Scan records
// because legacy barcodes may contain spaces and the search index normalizes
// them differently from Cloud's barcode_key.
export const findBarcodeConflictsInTable = async (menuTable, barcode, currentId = null) => {
  const key = normalizeBarcodeKey(barcode);
  if (!key) return [];

  return menuTable.filter((product) => (
    product?.id != null
    && product.id !== currentId
    && !product.deletedAt
    && !product.deletedTimestamp
    && !product.deleted_at
    && !product.deleted_timestamp
    && normalizeBarcodeKey(product.barcode) === key
  )).toArray();
};
