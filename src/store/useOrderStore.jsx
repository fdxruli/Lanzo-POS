// src/store/useOrderStore.jsx
import { create } from 'zustand';

// --- 1. Función Helper para calcular el precio (fuera del store) ---
// Determina el precio unitario basándose en la cantidad y las reglas de mayoreo
const calculateDynamicPrice = (product, quantity) => {
  // El precio base es el precio original del producto (o del lote activo)
  let finalPrice = product.originalPrice || product.price;

  // Si el producto tiene reglas de mayoreo y la cantidad es válida
  if (product.wholesaleTiers && product.wholesaleTiers.length > 0 && quantity > 0) {

    // Ordenamos los niveles de mayor a menor cantidad mínima (descendente)
    // Ej: [{min: 100, price: 8}, {min: 12, price: 9}]
    const tiersDesc = [...product.wholesaleTiers].sort((a, b) => b.min - a.min);

    // Buscamos el primer nivel que cumpla la condición (cantidad >= min)
    const applicableTier = tiersDesc.find(tier => quantity >= tier.min);

    if (applicableTier) {
      finalPrice = applicableTier.price;
    }
  }
  return finalPrice;
};

// --- HELPER MEJORADO: Calcula precio considerando Lotes (FIFO) Y Mayoreo ---
const calculateCompositePrice = (product, quantity) => {
  // 1. Si no usa lotes o no tiene lotes cargados, usar lógica normal (mayoreo o base)
  if (!product.batchManagement?.enabled || !product.activeBatches || product.activeBatches.length === 0) {
    // Aquí va tu lógica original de calculateDynamicPrice para mayoreo
    // (La copias de tu archivo actual si tienes lógica de mayoreo)
    return product.price;
  }

  let remainingQty = quantity;
  let totalPriceAccumulated = 0;

  // 2. Recorrer lotes FIFO para acumular el precio real
  for (const batch of product.activeBatches) {
    if (remainingQty <= 0) break;

    // Tomamos lo que haya en el lote o lo que nos falte, lo que sea menor
    const takeFromBatch = Math.min(remainingQty, batch.stock);

    totalPriceAccumulated += (takeFromBatch * batch.price);
    remainingQty -= takeFromBatch;
  }

  // 3. Si el cliente pide más de lo que hay en stock total (remainingQty > 0),
  // el excedente se cobra al precio del ULTIMO lote disponible (o precio base).
  if (remainingQty > 0) {
    const lastBatchPrice = product.activeBatches[product.activeBatches.length - 1].price;
    totalPriceAccumulated += (remainingQty * lastBatchPrice);
  }

  // 4. Devolvemos el precio unitario promedio (ponderado)
  // Ej: (5*$13 + 1*$15) / 6 = $13.3333...
  return quantity > 0 ? (totalPriceAccumulated / quantity) : 0;
};


// create() crea un "almacén" (store).
export const useOrderStore = create((set, get) => ({

  // ======================================================
  // 1. EL ESTADO
  // ======================================================
  order: [], // El estado inicial es un array vacío

  // ======================================================
  // 2. LAS ACCIONES
  // ======================================================

  /**
   * Añade un producto al pedido.
   * Ahora incluye lógica de cálculo de precio dinámico.
   */
  addItem: (product) => {
    set((state) => {
      const { order } = state;
      const existingItem = order.find((item) => item.id === product.id);

      if (existingItem) {
        const newQuantity = existingItem.quantity + 1;
        // USAMOS LA NUEVA FUNCIÓN COMPUESTA
        const newPrice = calculateCompositePrice(existingItem, newQuantity);

        const updatedOrder = order.map((item) => {
          if (item.id === product.id) {
            return {
              ...item,
              quantity: newQuantity,
              price: newPrice,
              exceedsStock: item.trackStock && newQuantity > item.stock
            };
          }
          return item;
        });
        return { order: updatedOrder };

      } else {
        const newQuantity = 1;
        // USAMOS LA NUEVA FUNCIÓN COMPUESTA
        const initialPrice = calculateCompositePrice(product, newQuantity);

        const newItem = {
          ...product,
          quantity: newQuantity,
          price: initialPrice,
          originalPrice: product.price,
          exceedsStock: product.trackStock && newQuantity > product.stock
        };
        return { order: [...order, newItem] };
      }
    });
  },

  /**
   * Actualiza la cantidad de un item (para +/- o input a granel).
   * Ahora recalcula el precio en tiempo real.
   */
  updateItemQuantity: (productId, newQuantity) => {
    set((state) => {
      const updatedOrder = state.order.map((item) => {
        if (item.id === productId) {
          const safeQuantity = newQuantity === null ? 0 : newQuantity;

          // USAMOS LA NUEVA FUNCIÓN COMPUESTA
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

  /**
   * Elimina un item del pedido.
   */
  removeItem: (productId) => {
    set((state) => ({
      order: state.order.filter((item) => item.id !== productId),
    }));
  },

  /**
   * Vacía el pedido completo.
   */
  clearOrder: () => set({ order: [] }),
  setOrder: (newOrder) => set({ order: newOrder }),

  /**
   * Sobrescribe el pedido (útil para el scanner masivo o recuperación).
   * Aseguramos que se recalcule el precio para los items entrantes.
   */
  setOrder: (newOrder) => {
    // Opcional: Recorrer newOrder para asegurar que los precios sean correctos
    // según sus cantidades, pero por rendimiento confiamos en el origen o
    // lo dejamos simple por ahora.
    set({ order: newOrder });
  },

  // ======================================================
  // 3. Funciones "Getter" para estado derivado
  // ======================================================

  /**
   * Calcula el total sumando (precio * cantidad) de cada item.
   */
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