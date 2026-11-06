// Only fields consumed by the existing pure financial/product algorithms.
// No customers, receipts, images, tenant identifiers or full catalog are copied.
const saleKeys = ['status', 'fulfillmentStatus', 'total', 'subtotal', 'discountTotal', 'discount_total', 'discount'];
const itemKeys = ['id', 'parentId', 'name', 'quantity', 'price', 'cost', 'lineTotal', 'line_total', 'exactTotal', 'lineSubtotal', 'subtotal', 'discountAmount', 'discount_amount', 'discount'];
const pick = (record, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(record, key)).map(key => [key, record[key]]));
export const projectBotSales = sales => sales.map(sale => ({ ...pick(sale, saleKeys), items: Array.isArray(sale.items) ? sale.items.map(item => pick(item, itemKeys)) : null }));

const stockKeys = ['id', 'name', 'productName', 'productId', 'trackStock', 'track_stock', 'isActive', 'is_active', 'stock', 'quantity', 'committedStock', 'committed_stock', 'minStock', 'min_stock'];
export const projectBotStock = records => records.map(record => pick(record, stockKeys));
