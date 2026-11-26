const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const text = value => typeof value === 'string' && value.trim() !== '';
const money = value => {
  if (!['number', 'string'].includes(typeof value) || !/^\d+(\.\d{1,2})?$/.test(String(value))) return null;
  const cents = Math.round(Number(value) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
};
const validRows = (rows) => Array.isArray(rows) && rows.every(row => text(row?.id))
  && new Set(rows.map(row => row.id)).size === rows.length;
const sameDate = (a, b) => a === null && b === null || (text(a) && text(b) && Number.isFinite(Date.parse(a)) && Date.parse(a) === Date.parse(b));

export const validateSaleRecoveryPage = (payload, { limit, dateFrom, reference, cursor, visibility }) => {
  if (payload?.success !== true) fail(payload?.code || 'CLOUD_SALE_SNAPSHOT_FAILED');
  if (payload.sync_deferred === true) fail('CLOUD_SALE_SNAPSHOT_DEFERRED');
  const ref = payload.snapshot_reference_change_seq;
  const next = payload.next_page_cursor;
  const ids = new Set((Array.isArray(payload.sales) ? payload.sales : []).map(s => s?.id));
  if (payload.snapshot_contract !== 'keyset_reference_v1' || payload.snapshot_contract_version !== 1
    || payload.sync_deferred !== false || !Number.isSafeInteger(ref) || ref < 0
    || !Number.isSafeInteger(payload.safe_change_seq) || payload.safe_change_seq < ref
    || payload.limit !== limit || !sameDate(payload.scope?.date_from, dateFrom) || payload.scope?.date_to !== null
    || !['actor', 'authorized'].includes(payload.scope?.visibility)
    || (visibility !== null && payload.scope.visibility !== visibility)
    || !validRows(payload.sales) || !validRows(payload.items) || !validRows(payload.payments)
    || payload.sales.length > limit || (payload.has_more && payload.sales.length !== limit)
    || [...payload.items, ...payload.payments].some(row => !ids.has(row.sale_id))
    || typeof payload.has_more !== 'boolean' || payload.snapshot_complete !== !payload.has_more
    || (payload.has_more ? (!next || typeof next !== 'object' || Array.isArray(next)
      || JSON.stringify(next) === JSON.stringify(cursor)) : next !== null)) fail('CLOUD_SALE_SNAPSHOT_INCOMPLETE');
  if (payload.safe_change_seq !== ref || (reference !== null && reference !== ref)) fail('CLOUD_SALE_SNAPSHOT_REFERENCE_CHANGED');
  return { reference: ref, cursor: next, complete: payload.snapshot_complete, visibility: payload.scope.visibility };
};

// Both authorized SQL reads return all child rows for each delivered sale.
// Require a terminal committed projection and explicit financial/line evidence;
// never synthesize missing rows from the local draft.
export const validateRecoveredSale = ({ payload, cloudSale: sale, localSaleId, idempotencyKey }) => {
  const localId = sale?.local_sale_id || sale?.localSaleId || sale?.id;
  const key = sale?.idempotency_key || sale?.idempotencyKey || sale?.metadata?.ecommerceConversionKey || sale?.metadata?.idempotencyKey;
  if (!text(sale?.id) || (localId !== localSaleId && key !== idempotencyKey)
    || (key && key !== idempotencyKey)
    || (sale.local_sale_id && sale.local_sale_id !== localSaleId)) fail('CLOUD_SALE_RECOVERY_IDENTITY_CONFLICT');
  const items = Array.isArray(payload.items) ? payload.items.filter(row => row?.sale_id === sale.id) : null;
  const payments = Array.isArray(payload.payments) ? payload.payments.filter(row => row?.sale_id === sale.id) : null;
  const total = money(sale.total), paid = money(sale.amount_paid), balance = money(sale.balance_due);
  if (payload.success !== true || sale.status !== 'closed' || sale.source_mode !== 'cloud_committed'
    || sale.effects_status !== 'payment_recorded' || sale.deleted_at || sale.cancelled_at
    || !Number.isSafeInteger(sale.server_version) || sale.server_version < 1
    || !text(sale.sold_at) || !Number.isFinite(Date.parse(sale.sold_at))
    || total === null || paid === null || balance === null || paid + balance !== total
    || !text(sale.payment_method) || !text(sale.payment_status)
    || !validRows(items) || items.length === 0 || !validRows(payments)
    || items.some(row => !text(row.product_name) || !Number.isFinite(Number(row.quantity))
      || Number(row.quantity) <= 0 || money(row.unit_price) === null || money(row.line_total) === null)
    || payments.some(row => !text(row.method) || money(row.amount) === null)
    || (paid > 0 && payments.length === 0)
    || payments.reduce((sum, row) => sum + money(row.amount), 0) !== paid) fail('CLOUD_SALE_RECOVERY_PROJECTION_INCOMPLETE');
};
