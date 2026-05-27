import { Money } from './moneyMath';

/**
 * Ensures the customer's debt is safely read, regardless of whether 
 * the database returns a Number, an exact String ("22.00"), or null/undefined.
 * It returns a primitive number so that legacy UI components can use .toFixed(2)
 * or math operations without crashing.
 * 
 * @param {string|number} debt - The debt value from the customer object.
 * @returns {number} The safe numeric representation of the debt.
 */
export const getSafeCustomerDebt = (debt) => {
  return Money.toNumber(debt || 0);
};

/**
 * Returns the debt as a formatted currency string.
 * @param {string|number} debt 
 * @returns {string} 
 */
export const formatCustomerDebt = (debt) => {
  const numericDebt = getSafeCustomerDebt(debt);
  return numericDebt.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
