import { Money } from '../../utils/moneyMath';

export const DISCOUNT_TYPES = Object.freeze({
  AMOUNT: 'amount',
  PERCENT: 'percent'
});

export const DISCOUNT_SCOPES = Object.freeze({
  LINE: 'line',
  SALE: 'sale'
});

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const cleanFinancialNumber = (value, fallback = 0) => {
  if (value === null || value === undefined || value === '') return fallback;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('El descuento tiene un valor inválido.');
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    const normalized = trimmed.replace(/[^0-9.-]+/g, '');
    if (!normalized || normalized === '-' || normalized === '.' || normalized === '-.') {
      return fallback;
    }
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) throw new Error('El descuento tiene un valor inválido.');
    return parsed;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error('El descuento tiene un valor inválido.');
  return parsed;
};

const normalizeDiscountType = (type) => {
  const raw = String(type || DISCOUNT_TYPES.AMOUNT).trim().toLowerCase();
  if (['percent', 'percentage', 'porcentaje', '%'].includes(raw)) return DISCOUNT_TYPES.PERCENT;
  return DISCOUNT_TYPES.AMOUNT;
};

export const getLineSubtotal = (item = {}) => {
  if (item.exactTotal !== undefined && item.exactTotal !== null) return Money.init(item.exactTotal);
  if (item.lineSubtotal !== undefined && item.lineSubtotal !== null) return Money.init(item.lineSubtotal);
  if (item.subtotal !== undefined && item.subtotal !== null) return Money.init(item.subtotal);
  return Money.multiply(item.price || 0, item.quantity || 0);
};

const extractDiscountInput = (source = {}) => {
  if (isObject(source.discount)) return source.discount;

  const directAmount = source.discountAmount ?? source.discount_amount;
  if (directAmount !== undefined && directAmount !== null && directAmount !== '') {
    return {
      type: DISCOUNT_TYPES.AMOUNT,
      value: directAmount,
      amount: directAmount,
      reason: source.discountReason ?? source.discount_reason,
      appliedAt: source.discountAppliedAt ?? source.discount_applied_at,
      appliedByRole: source.discountAppliedByRole ?? source.discount_applied_by_role,
      appliedByStaffUserId: source.discountAppliedByStaffUserId ?? source.discount_applied_by_staff_user_id,
      appliedByDeviceId: source.discountAppliedByDeviceId ?? source.discount_applied_by_device_id
    };
  }

  if (source.discount !== undefined && source.discount !== null && source.discount !== '') {
    return {
      type: DISCOUNT_TYPES.AMOUNT,
      value: source.discount,
      amount: source.discount,
      reason: source.discountReason ?? source.discount_reason,
      appliedAt: source.discountAppliedAt ?? source.discount_applied_at,
      appliedByRole: source.discountAppliedByRole ?? source.discount_applied_by_role,
      appliedByStaffUserId: source.discountAppliedByStaffUserId ?? source.discount_applied_by_staff_user_id,
      appliedByDeviceId: source.discountAppliedByDeviceId ?? source.discount_applied_by_device_id
    };
  }

  return null;
};

export const normalizeDiscount = (discountInput, options = {}) => {
  const {
    subtotal = 0,
    scope = DISCOUNT_SCOPES.LINE,
    strict = false,
    now = new Date().toISOString(),
    actor = {}
  } = options;

  if (!discountInput) return null;

  const raw = isObject(discountInput)
    ? discountInput
    : { type: DISCOUNT_TYPES.AMOUNT, value: discountInput, amount: discountInput };

  const baseSubtotal = Money.init(subtotal);
  if (baseSubtotal.lt(0)) throw new Error('El subtotal para descuento no puede ser negativo.');

  const type = normalizeDiscountType(raw.type);
  const value = cleanFinancialNumber(raw.value ?? raw.percent ?? raw.percentage ?? raw.amount ?? 0, 0);

  if (value < 0) throw new Error('El descuento no puede ser negativo.');
  if (type === DISCOUNT_TYPES.PERCENT && value > 100) {
    throw new Error('El porcentaje de descuento no puede ser mayor a 100%.');
  }

  let calculatedAmount = type === DISCOUNT_TYPES.PERCENT
    ? Money.divide(Money.multiply(baseSubtotal, value), 100)
    : Money.init(value);

  if (calculatedAmount.lt(0)) throw new Error('El descuento no puede ser negativo.');

  if (calculatedAmount.gt(baseSubtotal)) {
    if (strict) throw new Error('El descuento no puede superar el subtotal aplicable.');
    calculatedAmount = baseSubtotal;
  }

  const amount = Money.toNumber(calculatedAmount);
  if (amount <= 0) return null;

  const reason = String(raw.reason ?? raw.discountReason ?? raw.discount_reason ?? '').trim();
  if (!reason) throw new Error('El motivo del descuento es obligatorio.');

  return {
    type,
    value: Money.toNumber(value),
    amount,
    reason,
    scope,
    appliedAt: raw.appliedAt || raw.applied_at || now,
    appliedByRole: raw.appliedByRole || raw.applied_by_role || actor.role || undefined,
    appliedByStaffUserId: raw.appliedByStaffUserId || raw.applied_by_staff_user_id || actor.staffUserId || null,
    appliedByDeviceId: raw.appliedByDeviceId || raw.applied_by_device_id || actor.deviceId || null
  };
};

export const validateDiscount = (discountInput, options = {}) => normalizeDiscount(discountInput, {
  ...options,
  strict: true
});

export const calculateLineDiscount = (item = {}) => {
  const subtotal = getLineSubtotal(item);
  const discount = normalizeDiscount(extractDiscountInput(item), {
    subtotal,
    scope: DISCOUNT_SCOPES.LINE,
    strict: false
  });
  const discountAmount = Money.init(discount?.amount || 0);
  const lineTotal = Money.subtract(subtotal, discountAmount);

  return {
    subtotal: Money.toNumber(subtotal),
    discount,
    discountAmount: Money.toNumber(discountAmount),
    lineTotal: Money.toNumber(lineTotal.lt(0) ? 0 : lineTotal)
  };
};

export const calculateSaleDiscount = (subtotalAfterLineDiscounts = 0, saleDiscountInput = null) => {
  const subtotal = Money.init(subtotalAfterLineDiscounts);
  const discount = normalizeDiscount(saleDiscountInput, {
    subtotal,
    scope: DISCOUNT_SCOPES.SALE,
    strict: false
  });
  const discountAmount = Money.init(discount?.amount || 0);
  const total = Money.subtract(subtotal, discountAmount);

  return {
    subtotalAfterLineDiscounts: Money.toNumber(subtotal),
    discount,
    discountAmount: Money.toNumber(discountAmount),
    total: Money.toNumber(total.lt(0) ? 0 : total)
  };
};

export const calculateDiscountedTotals = (items = [], saleDiscountInput = null) => {
  const normalizedItems = (Array.isArray(items) ? items : []).map((item) => {
    const line = calculateLineDiscount(item);
    return {
      ...item,
      lineSubtotal: line.subtotal,
      discount: line.discount,
      discountAmount: line.discountAmount,
      discount_amount: line.discountAmount,
      lineTotal: line.lineTotal,
      line_total: line.lineTotal
    };
  });

  const lineTotals = normalizedItems.reduce((acc, item) => ({
    subtotal: Money.add(acc.subtotal, item.lineSubtotal || 0),
    lineDiscountTotal: Money.add(acc.lineDiscountTotal, item.discountAmount || 0),
    subtotalAfterLineDiscounts: Money.add(acc.subtotalAfterLineDiscounts, item.lineTotal || 0)
  }), {
    subtotal: Money.init(0),
    lineDiscountTotal: Money.init(0),
    subtotalAfterLineDiscounts: Money.init(0)
  });

  const saleDiscount = calculateSaleDiscount(lineTotals.subtotalAfterLineDiscounts, saleDiscountInput);
  const discountTotal = Money.add(lineTotals.lineDiscountTotal, saleDiscount.discountAmount || 0);

  return {
    items: normalizedItems,
    subtotal: Money.toNumber(lineTotals.subtotal),
    grossSubtotal: Money.toNumber(lineTotals.subtotal),
    lineDiscountTotal: Money.toNumber(lineTotals.lineDiscountTotal),
    subtotalAfterLineDiscounts: Money.toNumber(lineTotals.subtotalAfterLineDiscounts),
    saleDiscount: saleDiscount.discount,
    saleDiscountAmount: saleDiscount.discountAmount,
    discountTotal: Money.toNumber(discountTotal),
    total: saleDiscount.total
  };
};

export const buildDiscountAuditMetadata = ({ saleDiscount = null, discountTotal = 0 } = {}) => ({
  discount: saleDiscount || null,
  discount_total: Money.toNumber(discountTotal || 0)
});

export default {
  calculateDiscountedTotals,
  calculateLineDiscount,
  calculateSaleDiscount,
  normalizeDiscount,
  validateDiscount
};
