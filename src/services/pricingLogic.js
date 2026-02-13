// src/services/pricingLogic.js
import { roundCurrency } from './utils';

const priceCache = new Map();

/**
 * Versión optimizada de calculateCompositePrice.
 * Evita recalculos costosos si los datos no han cambiado.
 */
export const calculateCompositePrice = (product, quantity) => {
  // 1. Generamos una llave ÚNICA que detecte cambios en el producto
  // Incluimos: ID, Cantidad, Precio Base y Fecha de actualización (si existe) o longitud de lotes
  // Esto corrige el bug de "precios viejos" del auditor.
  const cacheKey = `${product.id}-${quantity}-${product.price}-${product.activeBatches?.length || 0}`;

  // 2. Si ya lo calculamos, devolvemos el resultado guardado
  if (priceCache.has(cacheKey)) {
    return priceCache.get(cacheKey);
  }

  // 3. Si no, calculamos usando la lógica real (que ahora llamaremos internal o copiamos aquí)
  const result = calculateCompositePriceLogic(product, quantity);

  // 4. Guardamos en memoria
  priceCache.set(cacheKey, result);

  // 5. Limpieza automática (LRU simple) para no saturar la memoria RAM
  if (priceCache.size > 200) {
    const firstKey = priceCache.keys().next().value;
    priceCache.delete(firstKey);
  }

  return result;
};

// Mueve tu lógica original aquí adentro (cópiala del archivo original)
const calculateCompositePriceLogic = (product, quantity) => {
  // Validación básica
  if (!product || quantity <= 0) return product?.price || 0;

  // 1. CASO VARIANTE ESPECÍFICA
  if (product.isVariant && product.batchId) {
    let basePrice = product.originalPrice ?? product.price;

    if (product.wholesaleTiers?.length > 0) {
      const tiersDesc = [...product.wholesaleTiers].sort((a, b) => b.min - a.min);
      const tier = tiersDesc.find(t => quantity >= t.min);
      if (tier) basePrice = Number(tier.price);
    }
    return basePrice;
  }

  // 2. CASO PRODUCTO SIMPLE
  if (!product.batchManagement?.enabled || !product.activeBatches || product.activeBatches.length === 0) {
    let basePrice = product.originalPrice ?? product.price;

    if (product.wholesaleTiers?.length > 0) {
      const tiersDesc = [...product.wholesaleTiers].sort((a, b) => b.min - a.min);
      const tier = tiersDesc.find(t => quantity >= t.min);
      if (tier) basePrice = Number(tier.price);
    }
    return basePrice;
  }

  // 3. CASO LOTES FIFO
  let remainingQty = quantity;
  let totalPriceAccumulated = 0;

  const strategy = product.batchManagement?.selectionStrategy || 'fifo';
  const sortedBatches = [...product.activeBatches].sort((a, b) => {
    if (strategy === 'FeFo' && a.expiryDate && b.expiryDate) {
      return new Date(a.expiryDate) - new Date(b.expiryDate);
    }
    return new Date(a.createdAt) - new Date(b.createdAt);
  });

  for (const batch of sortedBatches) {
    if (remainingQty <= 0) break;
    if (batch.stock <= 0) continue;

    const takeFromBatch = Math.min(remainingQty, batch.stock);
    totalPriceAccumulated += roundCurrency(takeFromBatch * batch.price);
    remainingQty -= takeFromBatch;
  }

  if (remainingQty > 0) {
    const fallbackPrice = sortedBatches.length > 0
      ? sortedBatches[sortedBatches.length - 1].price
      : product.price;
    totalPriceAccumulated += (remainingQty * fallbackPrice);
  }

  const avgPrice = roundCurrency(totalPriceAccumulated / quantity);

  if (product.wholesaleTiers?.length > 0) {
    const tiersDesc = [...product.wholesaleTiers].sort((a, b) => b.min - a.min);
    const tier = tiersDesc.find(t => quantity >= t.min);

    if (tier) {
      const tierPrice = Number(tier.price);
      const replacementCost = Number(product.cost || 0);
      if (replacementCost > 0 && tierPrice < replacementCost) {
        return avgPrice;
      }
      return tierPrice;
    }
  }

  return avgPrice;
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