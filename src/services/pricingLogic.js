// src/services/pricingLogic.js
import { roundCurrency } from './utils';
import { Money } from '../utils/moneyMath';

const priceCache = new Map();

// 1. NUEVA FUNCIÓN BASE: Devuelve la verdad contable exacta
export const calculatePricingDetails = (product, quantity) => {
  const batchesSignature = product.activeBatches?.length > 0
    ? product.activeBatches.map(b => `${b.id}:${b.stock}:${b.price}`).join('|')
    : 'no-batches';

  const cacheKey = `details-${product.id}-${quantity}-${product.price}-${batchesSignature}`;

  if (priceCache.has(cacheKey)) return priceCache.get(cacheKey);

  const result = calculatePricingDetailsLogic(product, quantity);

  priceCache.set(cacheKey, result);
  if (priceCache.size > 200) {
    const firstKey = priceCache.keys().next().value;
    priceCache.delete(firstKey);
  }

  return result;
};

// 2. ADAPTADOR: Mantiene compatibilidad con la UI vieja que solo pide un número
export const calculateCompositePrice = (product, quantity) => {
  return calculatePricingDetails(product, quantity).unitPrice;
};

// 3. LA LÓGICA CORREGIDA (Sin redondeos prematuros)
const calculatePricingDetailsLogic = (product, quantity) => {
  if (!product || quantity <= 0) return { unitPrice: product?.price || 0, exactTotal: 0 };

  const applyWholesale = (basePrice) => {
    let finalPrice = basePrice;
    if (product.wholesaleTiers?.length > 0) {
      const tiersDesc = [...product.wholesaleTiers].sort((a, b) => b.min - a.min);
      const tier = tiersDesc.find(t => quantity >= t.min);
      if (tier) {
        const replacementCost = Number(product.cost || 0);
        const tierPrice = Number(tier.price);
        // Regla de no perder dinero
        if (!(replacementCost > 0 && tierPrice < replacementCost)) {
          finalPrice = tierPrice;
        }
      }
    }
    return { unitPrice: finalPrice, exactTotal: roundCurrency(finalPrice * quantity) };
  };

  // CASOS SIN LOTES FIFO
  if (!product.batchManagement?.enabled || !product.activeBatches || product.activeBatches.length === 0 || (product.isVariant && product.batchId)) {
    return applyWholesale(Number(product.originalPrice ?? product.price));
  }

  // CASO LOTES FIFO
  let remainingQty = Money.init(quantity);
  let totalPriceAccumulated = Money.init(0);

  const strategy = product.batchManagement?.selectionStrategy || 'fifo';
  const sortedBatches = [...product.activeBatches].sort((a, b) => {
    if (strategy === 'FeFo' && a.expiryDate && b.expiryDate) {
      return new Date(a.expiryDate) - new Date(b.expiryDate);
    }
    return new Date(a.createdAt) - new Date(b.createdAt);
  });

  for (const batch of sortedBatches) {
    if (remainingQty.lte(0)) break;
    if (batch.stock <= 0) continue;

    const takeFromBatch = remainingQty.lt(batch.stock) ? remainingQty : Money.init(batch.stock);

    // Multiplicación exacta sin redondeo intermedio
    const costOfBatch = Money.multiply(takeFromBatch, batch.price);
    totalPriceAccumulated = Money.add(totalPriceAccumulated, costOfBatch);
    remainingQty = Money.subtract(remainingQty, takeFromBatch);
  }

  if (remainingQty.gt(0)) {
    const fallbackPrice = sortedBatches.length > 0
      ? sortedBatches[sortedBatches.length - 1].price
      : product.price;
    const fallbackCost = Money.multiply(remainingQty, fallbackPrice);
    totalPriceAccumulated = Money.add(totalPriceAccumulated, fallbackCost);
  }

  // CORRECCIÓN: El redondeo absoluto se hace al final
  const exactTotal = roundCurrency(totalPriceAccumulated);
  const finalUnitPrice = roundCurrency(totalPriceAccumulated / quantity);

  // Verificación de Mayoreo sobre Lotes
  if (product.wholesaleTiers?.length > 0) {
    const wholesaleResult = applyWholesale(Number(product.originalPrice ?? product.price));
    // Si el mayoreo otorga un mejor precio total de forma segura, se aplica
    if (wholesaleResult.exactTotal < exactTotal) {
      return wholesaleResult;
    }
  }

  return {
    unitPrice: Money.divide(totalPriceAccumulated, quantity).round(4).toNumber(), // 4 decimales para precisión unitaria
    exactTotal: totalPriceAccumulated.round(2).toNumber()
  };
};
/**
 * [NUEVO] Validador de Reglas de Negocio (Detective de Precios)
 * Verifica si aplicar mayoreo causaría pérdidas sin alterar el cálculo real.
 */
export const validateWholesaleCondition = (product, quantity) => {
  // 1. Si no hay producto o no tiene reglas de mayoreo, todo OK.
  if (!product || !product.wholesaleTiers || product.wholesaleTiers.length === 0) {
    return { status: 'ok' };
  }

  // 2. Buscamos qué regla de mayoreo aplicaría por cantidad
  const tiersDesc = [...product.wholesaleTiers].sort((a, b) => b.min - a.min);
  const tier = tiersDesc.find(t => quantity >= t.min);

  if (tier) {
    const tierPrice = Number(tier.price);
    const replacementCost = Number(product.cost || 0);

    // 3. LA REGLA DE ORO: Si hay costo definido y el precio mayoreo es menor... ¡ALERTA!
    // Esto protege Ferretería (acero sube de precio) y Abarrotes.
    if (replacementCost > 0 && tierPrice < replacementCost) {
      return {
        status: 'conflict',
        reason: 'below_cost',
        tierPrice: tierPrice,      // Precio que el cliente quería
        cost: replacementCost,     // Costo real actual
        safePrice: product.price   // Precio regular (seguro)
      };
    }
  }

  return { status: 'ok' };
};

/**
 * Calcula el total de una línea de pedido.
 */
export const calculateLineTotal = (price, quantity) => {
  return (price || 0) * (quantity || 0);
};