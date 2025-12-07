// src/store/useOrderStore.jsx
import { create } from 'zustand';
import { persist } from 'zustand/middleware'; // <--- Importante
import { calculateCompositePrice } from '../services/pricingLogic';
import { roundCurrency } from '../services/utils';

export const useOrderStore = create(
  persist(
    (set, get) => ({
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
            return roundCurrency(sum + roundCurrency(item.price * item.quantity));
          }
          return sum;
        }, 0);
      },
    }),
    {
      name: 'lanzo-cart-storage', // Nombre único en LocalStorage para no mezclar datos
      partialize: (state) => ({ order: state.order }), // Solo persistimos el array 'order'
    }
  )
);