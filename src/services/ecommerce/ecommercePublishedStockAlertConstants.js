export const ECOMMERCE_PUBLISHED_STOCK_ALERT_TTL_MS = 2 * 60 * 1000;

export const ECOMMERCE_PUBLISHED_STOCK_ALERT_ROUTE = (
  '/configuracion?tab=portal-online&focus=products'
);

export const ECOMMERCE_PUBLISHED_STOCK_STATUS = Object.freeze({
  IN_STOCK: 'in_stock',
  OUT_OF_STOCK: 'out_of_stock',
  NOT_TRACKED: 'not_tracked',
  UNVERIFIED: 'unverified',
  SOURCE_MISSING: 'source_missing',
  INACTIVE_SOURCE: 'inactive_source'
});

export const ECOMMERCE_PUBLISHED_STOCK_ALERT_EVENT = (
  'lanzo:ecommerce-published-stock-alert'
);
