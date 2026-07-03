import { normalizeSelectedModifiersForPersistence } from '../../utils/restaurantModifierIdentity';

const DEFAULT_STATION = Object.freeze({
  code: 'kitchen',
  name: 'Cocina'
});

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeText = (value, fallback = null) => {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : fallback;
};

const getRestaurantMeta = (entity = {}) => entity?.metadata?.restaurant || {};

const normalizeStations = (stations = []) => {
  const activeStations = (Array.isArray(stations) ? stations : [])
    .filter((station) => station?.code && station?.isActive !== false)
    .map((station) => ({
      code: String(station.code).trim() || DEFAULT_STATION.code,
      name: normalizeText(station.name, DEFAULT_STATION.name),
      isActive: station.isActive !== false
    }));

  return activeStations.length > 0 ? activeStations : [{ ...DEFAULT_STATION, isActive: true }];
};

const buildStationLookup = (stations = []) => {
  const lookup = new Map();
  normalizeStations(stations).forEach((station) => {
    lookup.set(station.code, station);
  });
  return lookup;
};

export const resolveRestaurantItemStation = ({ item = {}, product = null, stations = [] } = {}) => {
  const itemMeta = getRestaurantMeta(item);
  const productMeta = getRestaurantMeta(product || {});
  const stationLookup = buildStationLookup(stations);

  const stationCode = normalizeText(
    item.printStation ||
    itemMeta.printStation ||
    product?.printStation ||
    productMeta.printStation,
    DEFAULT_STATION.code
  );

  const activeStation = stationLookup.get(stationCode);
  if (!activeStation) {
    return { ...DEFAULT_STATION };
  }

  const stationName = normalizeText(
    item.printStationName ||
    itemMeta.printStationName ||
    product?.printStationName ||
    productMeta.printStationName,
    activeStation.name || DEFAULT_STATION.name
  );

  return {
    code: activeStation.code || DEFAULT_STATION.code,
    name: stationName || DEFAULT_STATION.name
  };
};

export const buildRestaurantOrderPayloadFromOpenSale = ({
  sale,
  items = null,
  stations = [],
  productsById = new Map()
} = {}) => {
  if (!sale?.id) {
    throw new Error('RESTAURANT_ORDER_SALE_REQUIRED');
  }

  const saleItems = Array.isArray(items) ? items : (Array.isArray(sale.items) ? sale.items : []);
  const total = toNumber(sale.total, 0);
  const subtotal = toNumber(sale.subtotal ?? sale.total, total);

  const order = {
    localOrderId: sale.id,
    saleId: sale.id,
    tableLabel: normalizeText(sale.tableData, null),
    customerId: normalizeText(sale.customerId || sale.customer?.id, null),
    customerName: normalizeText(sale.customerName || sale.customer?.name, null),
    status: 'pending',
    fulfillmentStatus: 'pending',
    source: 'tables',
    notes: normalizeText(sale.notes, null),
    subtotal,
    total,
    currency: normalizeText(sale.currency, 'MXN'),
    metadata: {
      phase: 'REST.2',
      source: 'useTableManagement',
      localStatus: sale.status || null,
      localFulfillmentStatus: sale.fulfillmentStatus || null
    }
  };

  const mappedItems = saleItems
    .map((item, index) => {
      const quantity = toNumber(item?.quantity, 0);
      if (quantity <= 0) return null;

      const productId = normalizeText(item.productId || item.id, null);
      const product = productId && productsById instanceof Map ? productsById.get(productId) : null;
      const station = resolveRestaurantItemStation({ item, product, stations });
      const unitPrice = toNumber(item.unitPrice ?? item.price, 0);

      return {
        localLineId: normalizeText(item.lineId || item.uniqueLineId || item.localLineId, `${sale.id}_${index}`),
        productId,
        productName: normalizeText(item.productName || item.name || item.nombre, 'Producto'),
        quantity,
        unitPrice,
        lineTotal: toNumber(item.lineTotal, unitPrice * quantity),
        notes: normalizeText(item.notes || item.kitchenNotes, null),
        selectedModifiers: normalizeSelectedModifiersForPersistence(item.selectedModifiers),
        stationCode: station.code,
        stationName: station.name,
        sortOrder: index,
        metadata: {
          phase: 'REST.2',
          source: 'local_sale',
          batchId: item.batchId || null,
          isVariant: Boolean(item.isVariant)
        }
      };
    })
    .filter(Boolean);

  return { order, items: mappedItems };
};

export default buildRestaurantOrderPayloadFromOpenSale;
