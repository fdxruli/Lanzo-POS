const ACTIVE_STATUSES = new Set(['active', 'ready']);
const TERMINAL_STATUSES = new Set(['completed', 'cancelled']);

export const normalizeLayawayStatus = (layaway = {}) => (
  String(layaway.status || 'active').trim().toLowerCase()
);

export const isTerminalLayaway = (layaway = {}) => (
  TERMINAL_STATUSES.has(normalizeLayawayStatus(layaway))
);

export const isActionableLayaway = (layaway = {}) => (
  ACTIVE_STATUSES.has(normalizeLayawayStatus(layaway))
);

export const splitLayawaysForDisplay = (layaways = []) => {
  const active = [];
  const history = [];

  for (const layaway of Array.isArray(layaways) ? layaways : []) {
    if (isTerminalLayaway(layaway)) history.push(layaway);
    else active.push(layaway);
  }

  const newestFirst = (left, right) => (
    new Date(right.updatedAt || right.deliveredAt || right.createdAt || 0)
      - new Date(left.updatedAt || left.deliveredAt || left.createdAt || 0)
  );

  return {
    active: active.sort(newestFirst),
    history: history.sort(newestFirst)
  };
};

const readSaleId = (sale = {}) => String(
  sale.cloudSaleId
  || sale.cloud_sale_id
  || sale.id
  || ''
).trim();

const readSaleFolio = (sale = {}) => String(
  sale.posFolio
  || sale.pos_folio
  || sale.operationalFolio
  || sale.operational_folio
  || sale.folio
  || sale.cloudFolio
  || sale.cloud_folio
  || ''
).trim() || null;

/**
 * Keeps the internal sale ID as an in-memory join key only. Callers receive a
 * layaway-keyed, display-safe folio map and must never render the join key.
 */
export const buildHistoricalLayawayFolios = ({ layaways = [], sales = [] } = {}) => {
  const folioBySaleId = new Map(
    (Array.isArray(sales) ? sales : [])
      .map((sale) => [readSaleId(sale), readSaleFolio(sale)])
      .filter(([saleId, folio]) => saleId && folio)
  );

  return (Array.isArray(layaways) ? layaways : []).reduce((result, layaway) => {
    const saleId = String(layaway?.conversionSaleId || layaway?.conversion_sale_id || '').trim();
    const folio = saleId ? folioBySaleId.get(saleId) : null;
    if (folio) result[layaway.id] = folio;
    return result;
  }, {});
};
