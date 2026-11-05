import Dexie from 'dexie';
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

const getCustomerSortDebtCents = (customer = {}) => {
  if (Number.isFinite(customer.debtCents)) return customer.debtCents;
  if (customer.debt !== null && customer.debt !== undefined && customer.debt !== '') {
    try {
      return Money.toCents(customer.debt);
    } catch { /* An unreadable balance stays unknown. */ }
  }
  // Sort unknown balances last; never persist a substitute financial value.
  return Number.NEGATIVE_INFINITY;
};

export const compareCustomersByDebt = (a, b) => {
  const key = (customer) => [
    getCustomerSortDebtCents(customer),
    customer.createdAt || DEFAULT_CUSTOMER_TIMESTAMP,
    customer.id
  ];
  return Dexie.cmp(key(b), key(a));
};
