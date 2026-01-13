// src/store/useOrderStore.jsx
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { calculateCompositePrice } from '../services/pricingLogic';
import { roundCurrency, safeLocalStorageSet } from '../services/utils';
import { queryBatchesByProductIdAndActive } from '../services/database';

const safeStorage = {
  getItem: (name) => localStorage.getItem(name),
  setItem: (name, value) => {
    // Usamos nuestra función protegida. 
    // Si falla, retorna false, pero Zustand no crashea.
    safeLocalStorageSet(name, value);
  },
  removeItem: (name) => localStorage.removeItem(name),
};

export const useOrderStore = create(
  persist(
    (set, get) => ({
      order: [],

      // --- [NUEVO] FUNCIÓN INTELIGENTE PARA ABARROTES ---
      // Esta es la función que debe llamar tu UI (Scanner y Menú)
      addSmartItem: async (product) => {
        let productToAdd = { ...product };

        // 1. DETECCIÓN: ¿El producto maneja lotes y no se ha especificado uno?
        // En abarrotes, esto pasa el 99% de las veces (leche, papas, enlatados).
        if (product.batchManagement?.enabled && !product.batchId) {
          try {
            // 2. BUSQUEDA SILENCIOSA: Traemos lotes activos de la BD
            const activeBatches = await queryBatchesByProductIdAndActive(product.id, true);

            if (activeBatches && activeBatches.length > 0) {
              // 3. REGLA FIFO (Primero en entrar, primero en salir)
              // Ordenamos por fecha de creación (createdAt).
              // Asumimos formato ISO string que se ordena lexicográficamente o por Date.
              activeBatches.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

              const oldestBatch = activeBatches[0];

              // 4. INYECCIÓN DE DATOS
              // Sobrescribimos el precio/costo con el del lote real y asignamos el ID.
              productToAdd = {
                ...productToAdd,
                batchId: oldestBatch.id,
                price: oldestBatch.price, // Precio real del lote
                cost: oldestBatch.cost,   // Costo real (para reporte de ganancia exacta)
                stock: oldestBatch.stock, // Stock disponible de ESE lote
                isVariant: true,          // Tratamos como variante para que addItem lo separe
                skuDetected: oldestBatch.sku || product.sku // Rastreabilidad
              };
            }
          } catch (error) {
            console.warn("⚠️ Fallo en asignación automática de lote, usando genérico:", error);
            // Si falla la BD, NO BLOQUEAMOS LA VENTA.
            // Continuamos con el producto base (Fallback de seguridad para Abarrotes).
          }
        }

        // 5. EJECUCIÓN: Llamamos a la acción original síncrona
        get().addItem(productToAdd);
      },

      addItem: (product) => {
        set((state) => {
          const { order } = state;

          // BUSCAR EXISTENCIA (Tu lógica actual es correcta)
          const existingItemIndex = order.findIndex((item) => {
            if (product.isVariant && product.batchId) {
              return item.batchId === product.batchId;
            }
            return item.id === product.id;
          });

          if (existingItemIndex >= 0) {
            // Lógica de actualizar cantidad...
            const existingItem = order[existingItemIndex];
            const newQuantity = existingItem.quantity + 1;

            // [MEJORA] Validación de Stock en tiempo real para UX
            const stockLimit = existingItem.stock || 99999;
            const exceedsStock = existingItem.trackStock && newQuantity > stockLimit;

            const newPrice = calculateCompositePrice(existingItem, newQuantity);

            const updatedOrder = [...order];
            updatedOrder[existingItemIndex] = {
              ...existingItem,
              quantity: newQuantity,
              price: newPrice,
              exceedsStock: exceedsStock
            };
            return { order: updatedOrder };

          } else {
            // Lógica de agregar nuevo...
            const newQuantity = 1;
            const initialPrice = calculateCompositePrice(product, newQuantity);

            const newItem = {
              ...product,
              quantity: newQuantity,
              price: initialPrice,
              originalPrice: product.price,
              // [MEJORA] Si viene de addSmartItem, ya trae el stock del lote correcto
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
      storage: createJSONStorage(() => safeStorage),
      partialize: (state) => ({ order: state.order }), // Solo persistimos el array 'order'
    }
  )
);