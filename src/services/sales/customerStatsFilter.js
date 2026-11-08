const normalizeId = (value) => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
};

export const getCustomerRelationId = (record = {}) => normalizeId(
  record.customerId ?? record.customer_id
);

const getSaleReferenceId = (record = {}) => normalizeId(
  record.saleId ?? record.sale_id ?? record.referenceId ?? record.reference_id
);

const matchesCustomer = (record, customerId, saleIds) => {
  const relationId = getCustomerRelationId(record);
  if (relationId) return relationId === customerId;
  const saleId = getSaleReferenceId(record);
  return Boolean(saleId && saleIds.has(saleId));
};

const rows = (value) => (Array.isArray(value) ? value : []);

export const filterLocalDashboardReportForCustomer = (report = {}, customerId = null) => {
  if (!customerId) {
    return {
      report,
      salesAttributionIncomplete: false,
      paymentAttributionIncomplete: false
    };
  }

  const selectedId = String(customerId);
  const allSales = rows(report.sales);
  const allCancelledSales = rows(report.cancelledSales);
  const customerSales = allSales.filter((sale) => getCustomerRelationId(sale) === selectedId);
  const customerCancelledSales = allCancelledSales.filter((sale) => getCustomerRelationId(sale) === selectedId);
  const customerSaleIds = new Set([
    ...customerSales,
    ...customerCancelledSales
  ].map((sale) => normalizeId(sale.id)).filter(Boolean));
  const allSaleIds = new Map([...allSales, ...allCancelledSales]
    .map((sale) => [normalizeId(sale.id), getCustomerRelationId(sale)])
    .filter(([id]) => id));
  const ledger = rows(report.customerLedger);
  const cashReversals = rows(report.cashReversalMovements);
  const cancelledSales = allCancelledSales;

  const hasUnknownAttribution = (record) => {
    if (getCustomerRelationId(record)) return false;
    const saleId = getSaleReferenceId(record);
    if (!saleId) return true;
    const linkedCustomerId = allSaleIds.get(saleId);
    return !linkedCustomerId;
  };

  const customerLedger = ledger.filter((row) => matchesCustomer(row, selectedId, customerSaleIds));
  const customerCashReversals = cashReversals.filter((row) => matchesCustomer(row, selectedId, customerSaleIds));
  const matchedCancelledSales = cancelledSales.filter((row) => matchesCustomer(row, selectedId, customerSaleIds));

  return {
    report: {
      ...report,
      sales: customerSales,
      customerLedger,
      cashReversalMovements: customerCashReversals,
      cancelledSales: matchedCancelledSales,
      customers: rows(report.customers).filter((customer) => normalizeId(customer.id) === selectedId)
    },
    salesAttributionIncomplete: allSales.some((sale) => !getCustomerRelationId(sale)),
    paymentAttributionIncomplete: ledger.some(hasUnknownAttribution)
      || cashReversals.some(hasUnknownAttribution)
      || cancelledSales.some(hasUnknownAttribution)
  };
};

export default filterLocalDashboardReportForCustomer;
