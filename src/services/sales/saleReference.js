const firstText = (...values) => {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return null;
};

export const getSaleFinancialFolio = (sale = {}) => firstText(
  sale.folio,
  sale.cloudFolio,
  sale.cloud_folio,
  sale.localFolio,
  sale.local_folio,
  sale.id
);

export const getSaleOperationalFolio = (sale = {}) => firstText(
  sale.posFolio,
  sale.pos_folio,
  sale.operationalFolio,
  sale.operational_folio
);

export const getSaleEcommerceOrderId = (sale = {}) => firstText(
  sale.ecommerceOrderId,
  sale.ecommerce_order_id,
  sale.metadata?.ecommerceOrderId,
  sale.metadata?.ecommerce_order_id
);

export const getSaleEcommerceOrderCode = (sale = {}) => firstText(
  sale.ecommerceOrderCode,
  sale.ecommerce_order_code,
  sale.metadata?.ecommerceOrderCode,
  sale.metadata?.ecommerce_order_code
);

export const getSaleIdentityReferences = (sale = {}) => [
  sale.id,
  sale.saleId,
  sale.sale_id,
  sale.cloudSaleId,
  sale.cloud_sale_id,
  sale.localSaleId,
  sale.local_sale_id,
  sale.metadata?.saleId,
  sale.metadata?.sale_id
].map((value) => firstText(value)).filter(Boolean);

export const getSaleChannel = (sale = {}) => {
  const explicit = firstText(sale.salesChannel, sale.sales_channel);
  if (explicit) return explicit.toLowerCase();
  return getSaleEcommerceOrderId(sale) || getSaleEcommerceOrderCode(sale)
    ? 'ecommerce'
    : 'local';
};

export const isEcommerceSale = (sale = {}) => getSaleChannel(sale) === 'ecommerce';

export const normalizeSaleTraceability = (sale = {}) => {
  const ecommerceOrderId = getSaleEcommerceOrderId(sale);
  const ecommerceOrderCode = getSaleEcommerceOrderCode(sale);
  const salesChannel = getSaleChannel(sale);

  return {
    salesChannel,
    ecommerceOrderId,
    ecommerceOrderCode
  };
};

export const getSaleDisplayReference = (sale = {}) => {
  if (isEcommerceSale(sale)) {
    return getSaleEcommerceOrderCode(sale) || getSaleFinancialFolio(sale);
  }

  return getSaleOperationalFolio(sale) || getSaleFinancialFolio(sale);
};

export const getSaleSecondaryReference = (sale = {}, { includeOrigin = true } = {}) => {
  if (!isEcommerceSale(sale)) return includeOrigin ? 'Venta local' : null;
  const folio = getSaleFinancialFolio(sale);
  if (!folio) return includeOrigin ? 'Ecommerce' : null;
  return includeOrigin ? `Venta ${folio} · Ecommerce` : `Venta ${folio}`;
};

export const getSaleOriginLabel = (sale = {}) => (
  isEcommerceSale(sale) ? 'Ecommerce' : 'Venta local'
);

export const saleMatchesReference = (sale = {}, query = '') => {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  if (!normalizedQuery) return true;

  return [
    ...getSaleIdentityReferences(sale),
    getSaleDisplayReference(sale),
    getSaleOperationalFolio(sale),
    getSaleFinancialFolio(sale),
    getSaleEcommerceOrderCode(sale),
    getSaleEcommerceOrderId(sale)
  ].filter(Boolean).some((value) => String(value).toLowerCase().includes(normalizedQuery));
};

export default {
  getSaleDisplayReference,
  getSaleSecondaryReference,
  getSaleOriginLabel,
  getSaleFinancialFolio,
  getSaleOperationalFolio,
  getSaleEcommerceOrderId,
  getSaleEcommerceOrderCode,
  getSaleIdentityReferences,
  getSaleChannel,
  isEcommerceSale,
  normalizeSaleTraceability,
  saleMatchesReference
};
