// src/store/useOrderStore.jsx
import { create } from 'zustand';

// ============================================================
// LÓGICA DE CÁLCULO DE PRECIOS (Helper puro)
// ============================================================

const calculateCompositePrice = (product, quantity) => {
  // 1. CASO VARIANTE ESPECÍFICA (Ropa, Zapatos, etc.)
  // Si el usuario seleccionó una variante específica (tiene batchId y flag isVariant),
  // el precio es FIJO de ese lote. No se promedia.
  if (product.isVariant && product.batchId) {
    let basePrice = product.price;

    // Aplicar mayoreo si existe
    if (product.wholesaleTiers?.length > 0 && quantity > 0) {
      const tiersDesc = [...product.wholesaleTiers].sort((a, b) => b.min - a.min);
      const tier = tiersDesc.find(t => quantity >= t.min);
      if (tier) basePrice = tier.price;
    }
    return basePrice;
  }

  // 2. CASO PRODUCTO SIMPLE (Sin gestión de lotes)
  if (!product.batchManagement?.enabled || !product.activeBatches || product.activeBatches.length === 0) {
    let basePrice = product.price;
    
    // Aplicar mayoreo
    if (product.wholesaleTiers?.length > 0 && quantity > 0) {
      const tiersDesc = [...product.wholesaleTiers].sort((a, b) => b.min - a.min);
      const tier = tiersDesc.find(t => quantity >= t.min);
      if (tier) basePrice = tier.price;
    }
    return basePrice;
  }

  // 3. CASO LOTES FIFO (Farmacia, Abarrotes - Promedio Ponderado)
  // Aquí sí nos interesa consumir los lotes más viejos primero y promediar el costo si se mezclan.
  let remainingQty = quantity;
  let totalPriceAccumulated = 0;

  // Ordenar FIFO estricto (Más antiguo primero)
  const sortedBatches = [...product.activeBatches].sort((a, b) => 
    new Date(a.createdAt) - new Date(b.createdAt)
  );

  for (const batch of sortedBatches) {
    if (remainingQty <= 0) break;
    if (batch.stock <= 0) continue; // Saltar vacíos

    const takeFromBatch = Math.min(remainingQty, batch.stock);
    totalPriceAccumulated += (takeFromBatch * batch.price);
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
  const avgPrice = quantity > 0 ? (totalPriceAccumulated / quantity) : 0;

  // Aplicar mayoreo sobre el resultado final si corresponde
  if (product.wholesaleTiers?.length > 0 && quantity > 0) {
    const tiersDesc = [...product.wholesaleTiers].sort((a, b) => b.min - a.min);
    const tier = tiersDesc.find(t => quantity >= t.min);
    // En mayoreo, usualmente el precio de oferta reemplaza al cálculo FIFO
    if (tier) return tier.price;
  }

  return avgPrice;
};


// ============================================================
// STORE ZUSTAND
// ============================================================

export const useOrderStore = create((set, get) => ({

  order: [],

  addItem: (product) => {
    set((state) => {
      const { order } = state;

      // BUSCAR EXISTENCIA:
      // - Si es variante, buscamos por ID de lote (batchId).
      // - Si es normal, buscamos por ID de producto.
      const existingItemIndex = order.findIndex((item) => {
        if (product.isVariant && product.batchId) {
          return item.batchId === product.batchId;
        }
        return item.id === product.id;
      });

      if (existingItemIndex >= 0) {
        // --- ACTUALIZAR ITEM EXISTENTE ---
        const existingItem = order[existingItemIndex];
        const newQuantity = existingItem.quantity + 1;
        const newPrice = calculateCompositePrice(existingItem, newQuantity);

        const updatedOrder = [...order];
        updatedOrder[existingItemIndex] = {
          ...existingItem,
          quantity: newQuantity,
          price: newPrice,
          exceedsStock: existingItem.trackStock && newQuantity > existingItem.stock
        };

        return { order: updatedOrder };

      } else {
        // --- AGREGAR NUEVO ITEM ---
        const newQuantity = 1;
        const initialPrice = calculateCompositePrice(product, newQuantity);

        const newItem = {
          ...product,
          quantity: newQuantity,
          price: initialPrice,
          originalPrice: product.price, // Guardamos referencia
          exceedsStock: product.trackStock && newQuantity > product.stock
        };

        return { order: [...order, newItem] };
      }
    });
  },

  updateItemQuantity: (itemId, newQuantity) => {
    set((state) => {
      const updatedOrder = state.order.map((item) => {
        // Nota: Aquí usamos itemId que debe ser único en el carrito
        // (En variants, el id del item en el carrito ya debería ser el batchId o un composite)
        if (item.id === itemId) {
          const safeQuantity = newQuantity === null ? 0 : newQuantity;
          const newPrice = calculateCompositePrice(item, safeQuantity);

          return {
            ...item,
            quantity: newQuantity,
            price: newPrice,
            exceedsStock: item.trackStock && safeQuantity > item.stock
          };
        }
        return item;
      });
      return { order: updatedOrder };
    });
  },

  removeItem: (itemId) => {
    set((state) => ({
      order: state.order.filter((item) => item.id !== itemId),
    }));
  },

  clearOrder: () => set({ order: [] }),
  
  setOrder: (newOrder) => set({ order: newOrder }),

  getTotalPrice: () => {
    const { order } = get();
    return order.reduce((sum, item) => {
      if (item.quantity && item.quantity > 0) {
        return sum + (item.price * item.quantity);
      }
      return sum;
    }, 0);
  },

}));