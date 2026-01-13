// src/services/pricingLogic.js
import { roundCurrency } from './utils';

/**
 * Calcula el precio unitario final basado en cantidad (Mayoreo) y Lotes (FIFO).
 * @param {Object} product - El producto con sus propiedades (wholesaleTiers, batches, etc).
 * @param {number} quantity - La cantidad solicitada.
 * @returns {number} El precio unitario calculado.
 */
export const calculateCompositePrice = (product, quantity) => {
  // Validación básica
  if (!product || quantity <= 0) return product?.price || 0;

  // 1. CASO VARIANTE ESPECÍFICA
  if (product.isVariant && product.batchId) {
    let basePrice = product.originalPrice ?? product.price;

    if (product.wholesaleTiers?.length > 0) {
      const tiersDesc = [...product.wholesaleTiers].sort((a, b) => b.min - a.min);
      const tier = tiersDesc.find(t => quantity >= t.min);
      // CAMBIO AQUÍ: Asegurar que sea número
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
      // CAMBIO AQUÍ: Asegurar que sea número
      if (tier) basePrice = Number(tier.price);
    }
    return basePrice;
  }

  // 3. CASO LOTES FIFO (Promedio Ponderado)
  let remainingQty = quantity;
  let totalPriceAccumulated = 0;

  // Ordenar FIFO estricto (Más antiguo primero)
  // NOTA: Asumimos que activeBatches ya viene ordenado o lo ordenamos aquí.
  // Para pureza, mejor clonar y ordenar.
  const sortedBatches = [...product.activeBatches].sort((a, b) =>
    new Date(a.createdAt) - new Date(b.createdAt)
  );

  for (const batch of sortedBatches) {
    if (remainingQty <= 0) break;
    if (batch.stock <= 0) continue;

    const takeFromBatch = Math.min(remainingQty, batch.stock);
    totalPriceAccumulated += roundCurrency(takeFromBatch * batch.price);
    remainingQty -= takeFromBatch;
  }

  // Si pidieron más de lo que hay, el resto se cobra al precio actual (o del último lote)
  if (remainingQty > 0) {
    const fallbackPrice = sortedBatches.length > 0
      ? sortedBatches[sortedBatches.length - 1].price
      : product.price;
    totalPriceAccumulated += (remainingQty * fallbackPrice);
  }

  // Precio promedio resultante
  const avgPrice = roundCurrency(totalPriceAccumulated / quantity);

  // Aplicar mayoreo sobre el resultado final (Override)
  if (product.wholesaleTiers?.length > 0) {
    const tiersDesc = [...product.wholesaleTiers].sort((a, b) => b.min - a.min);
    const tier = tiersDesc.find(t => quantity >= t.min);

    if (tier) {
      const tierPrice = Number(tier.price);
      const replacementCost = Number(product.cost || 0);

      // VALIDACIÓN DE SEGURIDAD (Solo afecta si el producto tiene costo definido)
      // Si el precio de mayoreo es MENOR al costo de compra, ignoramos el mayoreo
      // y cobramos el precio promedio calculado (avgPrice) para evitar pérdidas.
      if (replacementCost > 0 && tierPrice < replacementCost) {
        // Opcional: Podrías retornar replacementCost, pero avgPrice es más seguro para el margen.
        return avgPrice;
      }

      return tierPrice;
    }
  }

  return avgPrice;
};

/**
 * Calcula el total de una línea de pedido.
 */
export const calculateLineTotal = (price, quantity) => {
  return (price || 0) * (quantity || 0);
};