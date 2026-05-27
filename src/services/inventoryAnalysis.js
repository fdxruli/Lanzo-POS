import {
  getExpiringBatchesInRange,
  loadData,
  STORES
} from './database';
import Logger from './Logger';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const startOfDay = (value) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const toSafeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getUrgencyLevel = (daysRemaining) => {
  if (daysRemaining <= 2) return 'critical';
  if (daysRemaining <= 5) return 'high';
  return 'medium';
};

// Actualiza la firma para recibir el nuevo parámetro 'batches'
export const buildLowStockProductsReport = (products = [], batches = [], options = {}) => {
  const { limit } = options;

  // Indexar lotes por ID de producto
  const batchesByProductId = (batches || []).reduce((acc, batch) => {
    if (!acc[batch.productId]) acc[batch.productId] = [];
    acc[batch.productId].push(batch);
    return acc;
  }, {});

  const report = (products || [])
    .filter((product) => {
      const minStock = toSafeNumber(product?.minStock);
      return (
        product?.isActive !== false &&
        Boolean(product?.trackStock) &&
        minStock > 0 &&
        toSafeNumber(product?.stock) <= minStock
      );
    })
    .map((product) => {
      const currentStock = toSafeNumber(product?.stock);
      const minStock = toSafeNumber(product?.minStock);
      const configuredMax = toSafeNumber(product?.maxStock);
      const targetStock = configuredMax > minStock ? configuredMax : minStock * 2;
      const rawDeficit = Math.max(0, targetStock - currentStock);
      const deficit = Math.ceil(rawDeficit);
      const urgency = minStock > 0 ? currentStock / minStock : 1;

      // RESOLUCIÓN DE PROVEEDOR
      let resolvedSupplier = product?.lastSupplier || product?.supplier;

      // Si no hay proveedor directo y el producto usa lotes, lo buscamos en su historial
      if (!resolvedSupplier && product?.hasBatches) {
        const productBatches = batchesByProductId[product.id] || [];

        // Ordenamos para priorizar el lote más reciente que tenga la propiedad 'supplier'
        const latestBatchWithSupplier = productBatches
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .find(b => b.supplier && b.supplier.trim() !== '');

        if (latestBatchWithSupplier) {
          resolvedSupplier = latestBatchWithSupplier.supplier;
        }
      }

      return {
        ...product,
        id: product?.id,
        name: product?.name,
        productName: product?.name,
        stock: currentStock,
        currentStock,
        minStock,
        maxStock: configuredMax > 0 ? configuredMax : targetStock,
        targetStock,
        deficit,
        suggestedOrder: deficit,
        supplierName: resolvedSupplier || 'Sin Proveedor Asignado', // Uso de la variable resuelta
        unit: product?.saleType === 'bulk'
          ? (product?.bulkData?.purchase?.unit || 'kg')
          : 'pza',
        urgency
      };
    })
    .sort((a, b) => {
      if (a.urgency !== b.urgency) {
        return a.urgency - b.urgency;
      }
      return b.deficit - a.deficit;
    });

  if (Number.isFinite(limit) && limit > 0) {
    return report.slice(0, limit);
  }

  return report;
};

export const buildExpiringProductsReport = ({
  products = [],
  riskBatches = [],
  daysThreshold = 30,
  now = new Date()
} = {}) => {
  const today = startOfDay(now);
  const thresholdDate = new Date(today);
  thresholdDate.setDate(thresholdDate.getDate() + Number(daysThreshold || 0));
  const productsById = new Map((products || []).map((product) => [product.id, product]));

  const batchAlerts = (riskBatches || [])
    .filter((batch) => Boolean(batch?.expiryDate))
    .map((batch) => {
      const product = productsById.get(batch.productId);
      const expDate = new Date(batch.expiryDate);
      if (Number.isNaN(expDate.getTime())) return null;

      const daysRemaining = Math.ceil((expDate - today) / MS_PER_DAY);
      const productName = product
        ? product.name
        : `Producto Eliminado (${batch.sku || '?'})`;

      return {
        id: batch.id,
        productId: batch.productId,
        productName,
        name: productName,
        stock: toSafeNumber(batch.stock),
        currentStock: toSafeNumber(batch.stock),
        expiryDate: batch.expiryDate,
        daysRemaining,
        daysLeft: daysRemaining,
        batchSku: batch.sku || 'Lote',
        location: batch.location || (product?.location || ''),
        type: 'Lote',
        urgencyLevel: getUrgencyLevel(daysRemaining)
      };
    })
    .filter(Boolean);

  const productAlerts = (products || [])
    .filter((product) => {
      if (!product?.shelfLife || product?.isActive === false) return false;
      if (product?.trackStock && toSafeNumber(product?.stock) <= 0) return false;

      const expDate = new Date(product.shelfLife);
      if (Number.isNaN(expDate.getTime())) return false;
      return expDate <= thresholdDate;
    })
    .map((product) => {
      const expDate = new Date(product.shelfLife);
      const daysRemaining = Math.ceil((expDate - today) / MS_PER_DAY);

      return {
        id: product.id,
        productId: product.id,
        productName: product.name,
        name: product.name,
        stock: toSafeNumber(product.stock),
        currentStock: toSafeNumber(product.stock),
        expiryDate: product.shelfLife,
        daysRemaining,
        daysLeft: daysRemaining,
        batchSku: 'General',
        location: product.location || '',
        type: 'Producto',
        urgencyLevel: getUrgencyLevel(daysRemaining)
      };
    });

  return [...batchAlerts, ...productAlerts]
    .sort((a, b) => a.daysRemaining - b.daysRemaining);
};

export const getLowStockProductsReport = async (options = {}) => {
  try {
    // Corrección: Cargar tanto el MENU como los lotes en paralelo.
    const [products, batches] = await Promise.all([
      loadData(STORES.MENU),
      loadData(STORES.PRODUCT_BATCHES)
    ]);
    // Pasamos los lotes a la función constructora
    return buildLowStockProductsReport(products || [], batches || [], options);
  } catch (error) {
    Logger.error('Error calculando reporte de stock bajo:', error);
    return [];
  }
};

export const getExpiringProductsReport = async ({ daysThreshold = 30 } = {}) => {
  try {
    const today = startOfDay(new Date());
    const thresholdDate = new Date(today);
    thresholdDate.setDate(thresholdDate.getDate() + Number(daysThreshold || 0));
    const thresholdIso = thresholdDate.toISOString();

    const [riskBatches, allProducts] = await Promise.all([
      getExpiringBatchesInRange(thresholdIso),
      loadData(STORES.MENU)
    ]);

    return buildExpiringProductsReport({
      products: allProducts || [],
      riskBatches: riskBatches || [],
      daysThreshold,
      now: today
    });
  } catch (error) {
    Logger.error('Error calculando reporte de caducidad:', error);
    return [];
  }
};

