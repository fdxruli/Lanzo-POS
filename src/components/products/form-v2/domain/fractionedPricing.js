import { toNumber } from './productFormNormalization';

export const calculateFractionedUnitCost = ({ purchaseCost, factor } = {}) => {
  const normalizedPurchaseCost = toNumber(purchaseCost);
  const normalizedFactor = toNumber(factor);
  if (normalizedPurchaseCost <= 0 || normalizedFactor <= 1) return 0;
  return normalizedPurchaseCost / normalizedFactor;
};

export const calculateSaleMargin = ({ cost, price } = {}) => {
  const normalizedCost = toNumber(cost);
  const normalizedPrice = toNumber(price);
  if (normalizedCost <= 0 || normalizedPrice <= 0) return 0;
  return ((normalizedPrice - normalizedCost) / normalizedPrice) * 100;
};

// The margin is expressed over the sale price, not as markup on cost.
export const formatProductSaleMargin = (cost, price) => {
  const c = toNumber(cost, NaN);
  const p = toNumber(price, NaN);
  if (!(c > 0 && p > 0)) return '';
  const margin = ((p - c) / p) * 100;
  if (!Number.isFinite(margin) || margin >= 100) return '';
  // Do not round a valid historical margin up to an invalid 100%.
  const rounded = margin.toFixed(1);
  return Number(rounded) >= 100 ? String(margin) : rounded;
};

export const getProductMarginError = (margin, cost) => {
  if (String(margin ?? '').trim() === '') return '';
  const value = Number(margin);
  if (!Number.isFinite(value) || value >= 100) return 'El margen sobre el precio de venta debe ser menor que 100 %.';
  if (cost !== undefined && !(toNumber(cost) > 0)) return 'Para calcular el precio por margen, introduce un costo mayor que cero o escribe el precio manualmente.';
  return '';
};
