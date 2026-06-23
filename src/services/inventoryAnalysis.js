import {
  getExpiringBatchesInRange,
  loadData,
  STORES
} from './database';
import { daysBetween } from '../utils/dateUtils';
import { getAvailableStock } from './db/utils';
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

const getQuantity = (item = {}) => {
  const quantity = Number(item.quantity ?? item.qty ?? item.stockDeducted ?? 0);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
};

const getRecordDate = (record = {}) => (
  record.timestamp || record.createdAt || record.date || record.fecha || null
);

const isCancelledOrOpenSale = (sale = {}) => {
  const status = String(sale.status || '').toLowerCase();
  const fulfillmentStatus = String(sale.fulfillmentStatus || '').toLowerCase();
  return ['cancelled', 'open'].includes(status) || ['cancelled', 'open'].includes(fulfillmentStatus);
};

const isWithinWindow = (record, cutoffMs) => {
  const time = Date.parse(getRecordDate(record));
  return Number.isFinite(time) && time >= cutoffMs;
};

const addConsumption = (map, productId, quantity) => {
  if (!productId || quantity <= 0) return;
  map.set(productId, (map.get(productId) || 0) + quantity);
};

const buildDemandByProductId = ({
  products = [],
  sales = [],
  wasteLogs = [],
  windowDays = 30,
  now = new Date()
} = {}) => {
  const productById = new Map((products || []).map((product) => [product.id, product]));
  const salesQuantity = new Map();
  const wasteQuantity = new Map();
  const days = Math.max(1, toSafeNumber(windowDays, 30));
  const cutoffMs = now.getTime() - (days * MS_PER_DAY);

  (sales || [])
    .filter((sale) => !isCancelledOrOpenSale(sale) && isWithinWindow(sale, cutoffMs))
    .forEach((sale) => {
      (sale.items || []).forEach((item) => {
        const soldQuantity = getQuantity(item);
        if (soldQuantity <= 0) return;

        const productDefinition = productById.get(item.id);
        const recipe = Array.isArray(productDefinition?.recipe)
          ? productDefinition.recipe
          : (Array.isArray(item.recipe) ? item.recipe : []);

        if (recipe.length > 0) {
          recipe.forEach((component) => {
            const componentId = component.ingredientId || component.productId || component.id;
            addConsumption(
              salesQuantity,
              componentId,
              toSafeNumber(component.quantity, 0) * soldQuantity
            );
          });
          return;
        }

        const batchUsesDifferentProducts = Array.isArray(item.batchesUsed)
          && item.batchesUsed.some((batch) => batch?.ingredientId && batch.ingredientId !== item.id);

        if (batchUsesDifferentProducts) {
          item.batchesUsed.forEach((batch) => {
            addConsumption(salesQuantity, batch.ingredientId, toSafeNumber(batch.quantity, 0));
          });
          return;
        }

        addConsumption(salesQuantity, item.id, soldQuantity);
      });
    });

  (wasteLogs || [])
    .filter((log) => isWithinWindow(log, cutoffMs))
    .forEach((log) => {
      addConsumption(
        wasteQuantity,
        log.productId || log.product_id || log.id,
        toSafeNumber(log.quantity, 0)
      );
    });

  const demand = new Map();
  const ids = new Set([...salesQuantity.keys(), ...wasteQuantity.keys()]);

  ids.forEach((id) => {
    const totalSales = salesQuantity.get(id) || 0;
    const totalWaste = wasteQuantity.get(id) || 0;
    demand.set(id, {
      salesQuantity: totalSales,
      wasteQuantity: totalWaste,
      averageDailySales: totalSales / days,
      averageDailyWaste: totalWaste / days,
      averageDailyDemand: (totalSales + totalWaste) / days
    });
  });

  return demand;
};

const getLeadTimeDays = (product = {}, fallback = 7) => {
  const value = [
    product.supplierLeadTimeDays,
    product.leadTimeDays,
    product.reorderLeadTimeDays,
    product.supplier?.leadTimeDays,
    fallback
  ].find((candidate) => toSafeNumber(candidate, NaN) > 0);

  return toSafeNumber(value, fallback);
};

const getSafetyStockDays = (product = {}, fallback = 3) => {
  const value = [
    product.safetyStockDays,
    product.coverageSafetyDays,
    fallback
  ].find((candidate) => toSafeNumber(candidate, NaN) >= 0);

  return toSafeNumber(value, fallback);
};

const getExpiringStockBeforeLeadTime = (productBatches = [], leadTimeDays = 0, now = new Date()) => {
  const leadTimeMs = now.getTime() + (Math.max(0, leadTimeDays) * MS_PER_DAY);

  return productBatches.reduce((sum, batch) => {
    const expiryMs = Date.parse(batch.alertTargetDate || batch.expiryDate);
    if (!Number.isFinite(expiryMs) || expiryMs > leadTimeMs) return sum;
    return sum + toSafeNumber(getAvailableStock(batch), 0);
  }, 0);
};

const resolvePurchaseUnit = (product = {}) => {
  if (product?.bulkData?.purchase?.unit) return product.bulkData.purchase.unit;
  if (product?.purchaseUnit) return product.purchaseUnit;
  if (product?.saleType === 'bulk') return product?.unit || 'kg';
  return product?.unit || 'pza';
};

// Actualiza la firma para recibir el nuevo parámetro 'batches'
export const buildLowStockProductsReport = (products = [], batches = [], options = {}) => {
  if (!Array.isArray(batches)) {
    options = batches || {};
    batches = [];
  }

  const {
    limit,
    sales = [],
    wasteLogs = [],
    windowDays = 30,
    now = new Date(),
    defaultLeadTimeDays = 7,
    defaultSafetyStockDays = 3
  } = options;

  const demandByProductId = buildDemandByProductId({
    products,
    sales,
    wasteLogs,
    windowDays,
    now
  });

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
        toSafeNumber(getAvailableStock(product)) <= minStock
      );
    })
    .map((product) => {
      const currentStock = toSafeNumber(getAvailableStock(product));
      const physicalStock = toSafeNumber(product?.stock);
      const minStock = toSafeNumber(product?.minStock);
      const configuredMax = toSafeNumber(product?.maxStock);
      const demand = demandByProductId.get(product.id) || {
        salesQuantity: 0,
        wasteQuantity: 0,
        averageDailySales: 0,
        averageDailyWaste: 0,
        averageDailyDemand: 0
      };
      const leadTimeDays = getLeadTimeDays(product, defaultLeadTimeDays);
      const safetyStockDays = getSafetyStockDays(product, defaultSafetyStockDays);
      const productBatches = batchesByProductId[product.id] || [];
      const expiringStockBeforeLeadTime = getExpiringStockBeforeLeadTime(productBatches, leadTimeDays, now);
      const stockAvailableAfterLeadTime = Math.max(0, currentStock - expiringStockBeforeLeadTime);
      const velocityTarget = Math.ceil(
        minStock + (demand.averageDailyDemand * (leadTimeDays + safetyStockDays))
      );
      const fallbackTarget = minStock * 2;
      const targetStock = configuredMax > minStock
        ? configuredMax
        : Math.max(fallbackTarget, velocityTarget);
      const rawDeficit = Math.max(0, targetStock - stockAvailableAfterLeadTime);
      const deficit = Math.ceil(rawDeficit);
      const urgency = minStock > 0 ? currentStock / minStock : 1;
      const coverageDays = demand.averageDailyDemand > 0
        ? currentStock / demand.averageDailyDemand
        : null;

      // RESOLUCIÓN DE PROVEEDOR
      let resolvedSupplier = product?.lastSupplier || product?.supplier;

      // Si no hay proveedor directo y el producto usa lotes, lo buscamos en su historial
      if (!resolvedSupplier && productBatches.length > 0) {

        // Ordenamos para priorizar el lote más reciente que tenga la propiedad 'supplier'
        const latestBatchWithSupplier = [...productBatches]
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
        stock: physicalStock,
        currentStock,
        availableStock: currentStock,
        physicalStock,
        minStock,
        maxStock: configuredMax > 0 ? configuredMax : targetStock,
        targetStock,
        deficit,
        suggestedOrder: deficit,
        supplierName: resolvedSupplier || 'Sin Proveedor Asignado', // Uso de la variable resuelta
        unit: resolvePurchaseUnit(product),
        urgency,
        averageDailySales: demand.averageDailySales,
        averageDailyWaste: demand.averageDailyWaste,
        averageDailyDemand: demand.averageDailyDemand,
        salesQuantity: demand.salesQuantity,
        wasteQuantity: demand.wasteQuantity,
        coverageDays,
        leadTimeDays,
        safetyStockDays,
        expiringStockBeforeLeadTime,
        stockAvailableAfterLeadTime
      };
    })
    .sort((a, b) => {
      if (a.coverageDays !== null && b.coverageDays !== null && a.coverageDays !== b.coverageDays) {
        return a.coverageDays - b.coverageDays;
      }

      if (a.coverageDays !== null && b.coverageDays === null) return -1;
      if (a.coverageDays === null && b.coverageDays !== null) return 1;

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
  daysThreshold: _daysThreshold = 30,
  now = new Date()
} = {}) => {
  const productsById = new Map((products || []).map((product) => [product.id, product]));

  // SSOT: El barrido de caducidades opera EXCLUSIVAMENTE sobre la colección de batches.
  // La propiedad product.shelfLife fue eliminada en la migración v15.
  return (riskBatches || [])
    .filter((batch) => Boolean(batch?.alertTargetDate || batch?.expiryDate))
    .map((batch) => {
      const product = productsById.get(batch.productId);
      const alertIso = batch.alertTargetDate || batch.expiryDate;
      if (!alertIso) return null;

      const todayIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
      const daysRemaining = daysBetween(todayIso, alertIso);
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
        alertTargetDate: batch.alertTargetDate || batch.expiryDate,
        alertType: batch.alertType || 'CADUCIDAD_LEGAL',
        daysRemaining,
        daysLeft: daysRemaining,
        batchSku: batch.sku || 'Lote',
        location: batch.location || (product?.location || ''),
        type: 'Lote',
        urgencyLevel: getUrgencyLevel(daysRemaining)
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.daysRemaining - b.daysRemaining);
};

export const getLowStockProductsReport = async (options = {}) => {
  try {
    // Corrección: Cargar tanto el MENU como los lotes en paralelo.
    const [products, batches, sales, wasteLogs] = await Promise.all([
      loadData(STORES.MENU),
      loadData(STORES.PRODUCT_BATCHES),
      loadData(STORES.SALES),
      loadData(STORES.WASTE)
    ]);
    // Pasamos los lotes a la función constructora
    return buildLowStockProductsReport(products || [], batches || [], {
      ...options,
      sales: sales || [],
      wasteLogs: wasteLogs || []
    });
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
