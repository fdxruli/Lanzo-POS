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
