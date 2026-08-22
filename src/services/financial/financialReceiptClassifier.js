/**
 * Protocol-only receipt interpretation shared by automatic recovery and
 * manual observability. It deliberately makes no decision about dispatch.
 */
export const FINANCIAL_RECEIPT_CLASSIFICATION = Object.freeze({
  COMPLETED: 'COMPLETED',
  PROCESSING: 'PROCESSING',
  CONFLICT: 'CONFLICT',
  NOT_FOUND: 'NOT_FOUND',
  UNKNOWN: 'UNKNOWN'
});

export const classifyFinancialReceipt = (receipt) => {
  const status = String(receipt?.status || '').trim().toUpperCase();
  return FINANCIAL_RECEIPT_CLASSIFICATION[status] || FINANCIAL_RECEIPT_CLASSIFICATION.UNKNOWN;
};
