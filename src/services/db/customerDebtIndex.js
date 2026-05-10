import { Money } from '../../utils/moneyMath';

export const CUSTOMER_DEBT_SORT_INDEX = '[debtCents+createdAt+id]';

const DEFAULT_CUSTOMER_TIMESTAMP = '1970-01-01T00:00:00.000Z';

export const normalizeCustomerDebtCents = (debt = 0) => {
  try {
    return Money.toCents(debt);
  } catch {
    return 0;
  }
};

export const getCustomerOrderingAnchor = (customer = {}) => {
  return customer.updatedAt || customer.createdAt || DEFAULT_CUSTOMER_TIMESTAMP;
};

export const matchesCustomerSnapshot = (customer = {}, snapshotAt = null) => {
  if (!snapshotAt) return true;
  return getCustomerOrderingAnchor(customer) <= snapshotAt;
};
