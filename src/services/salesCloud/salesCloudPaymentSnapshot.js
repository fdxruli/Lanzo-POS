import { Money } from '../../utils/moneyMath';
import {
  getExplicitSalePaymentSource,
  normalizeRestaurantSplitPaymentMethod
} from '../sales/paymentMethodContract';

const text = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
const monetaryValue = (value) => {
  if (!['string', 'number'].includes(typeof value) || value === '' || !Number.isFinite(Number(value))) return null;
  try {
    return Money.toExactString(value);
  } catch {
    return null;
  }
};

// Keep the server's financial row shape, with a strict field allowlist. Do not
// filter invalid/zero rows: their non-empty source must still prohibit fallback.
export const normalizeCloudSalePaymentRows = (rows, { saleId = null } = {}) => rows.map((value) => {
  const payment = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const row = {
    method: normalizeRestaurantSplitPaymentMethod(payment.method || payment.paymentMethod || payment.payment_method),
    amount: monetaryValue(payment.amount ?? payment.total)
  };
  for (const [key, alias] of [
    ['id', 'id'], ['sale_id', 'saleId'], ['reference', 'reference'],
    ['cash_session_id', 'cashSessionId'], ['cash_station_id', 'cashStationId'],
    ['cash_movement_id', 'cashMovementId'], ['customer_ledger_id', 'customerLedgerId']
  ]) {
    const field = text(payment[key] ?? payment[alias]);
    if (field !== null) row[key] = field;
  }
  for (const [key, alias] of [['received_amount', 'receivedAmount'], ['change_amount', 'changeAmount']]) {
    const field = monetaryValue(payment[key] ?? payment[alias]);
    if (field !== null) row[key] = field;
  }
  const metadata = {};
  for (const key of ['source', 'phase', 'split_payer_id', 'splitPayerId']) {
    const field = text(payment.metadata?.[key]);
    if (field !== null) metadata[key] = field;
  }
  if (typeof payment.metadata?.snapshotOnly === 'boolean') metadata.snapshotOnly = payment.metadata.snapshotOnly;
  if (Object.keys(metadata).length > 0) row.metadata = metadata;
  if (!row.sale_id && saleId) row.sale_id = saleId;
  return row;
});

export const cloudSalePaymentSnapshot = ({ response = {}, cloudSale = {}, localSale = {} }) => {
  const source = getExplicitSalePaymentSource(response)
    ?? getExplicitSalePaymentSource(cloudSale)
    ?? getExplicitSalePaymentSource(localSale);
  return source === null ? undefined : normalizeCloudSalePaymentRows(source, { saleId: cloudSale.id });
};
