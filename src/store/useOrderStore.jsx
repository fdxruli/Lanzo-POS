// src/store/useOrderStore.jsx
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { calculateCompositePrice, validateWholesaleCondition } from '../services/pricingLogic';
import { roundCurrency, safeLocalStorageSet, showMessageModal } from '../services/utils';
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

          const existingItemIndex = order.findIndex((item) => {
            if (product.isVariant && product.batchId) {
              return item.batchId === product.batchId;
            }
            return item.id === product.id;
          });

          // Calculamos cantidad tentativa
          let quantityToCheck = 1;
          let existingItem = null;

          if (existingItemIndex >= 0) {
            existingItem = order[existingItemIndex];
            quantityToCheck = existingItem.quantity + 1;
          }

          // 1. VALIDACIÓN
          const validation = validateWholesaleCondition(product, quantityToCheck);

          let initialPrice;
          let isPriceWarning = false;
          let shouldShowModal = false;

          // Recuperamos decisiones previas (si el item ya existe)
          const forceWholesale = existingItem?.forceWholesale || false;
          const forceSafePrice = existingItem?.forceSafePrice || false;

          // --- LÓGICA CON MEMORIA ---
          if (validation.status === 'conflict') {
            if (forceWholesale) {
              // CASO 1: El usuario YA HABÍA ACEPTADO la pérdida anteriormente
              initialPrice = validation.tierPrice;
              isPriceWarning = true; // Mantenemos la alerta visual
            } else if (forceSafePrice) {
              // CASO 2: El usuario YA HABÍA RECHAZADO (quería precio regular)
              initialPrice = validation.safePrice;
              isPriceWarning = true;
            } else {
              // CASO 3: Primera vez que ocurre el conflicto -> PREGUNTAR
              initialPrice = validation.safePrice; // Protegemos por defecto
              isPriceWarning = true;
              shouldShowModal = true;
            }
          } else {
            // No hay conflicto, calculamos normal
            initialPrice = calculateCompositePrice(product, quantityToCheck);
          }

          // --- MODAL (Solo si shouldShowModal es true) ---
          if (shouldShowModal) {
            showMessageModal(
              `El precio de mayoreo ($${validation.tierPrice}) es menor al costo ($${validation.cost}).\n\n¿Deseas autorizar esta venta bajo costo?`,
              () => {
                // ACCIÓN "SÍ" (Autorizar)
                set((innerState) => {
                  const currentOrder = [...innerState.order];
                  const idx = currentOrder.findIndex((item) =>
                    (product.isVariant && product.batchId) ? item.batchId === product.batchId : item.id === product.id
                  );
                  if (idx >= 0) {
                    currentOrder[idx] = {
                      ...currentOrder[idx],
                      price: validation.tierPrice, // Aplicamos precio bajo
                      forceWholesale: true,        // RECORDAR DECISIÓN [SÍ]
                      forceSafePrice: false
                    };
                  }
                  return { order: currentOrder };
                });
              },
              {
                title: '⚠️ Autorización de Costo',
                type: 'warning',
                confirmButtonText: 'Sí, Autorizar',
                showCancel: false,
                // Usamos el botón extra para el "No" explícito con memoria
                extraButton: {
                  text: 'No, Precio Regular',
                  action: () => {
                    // ACCIÓN "NO" (Mantener regular y no molestar)
                    set((innerState) => {
                      const currentOrder = [...innerState.order];
                      const idx = currentOrder.findIndex((item) =>
                        (product.isVariant && product.batchId) ? item.batchId === product.batchId : item.id === product.id
                      );
                      if (idx >= 0) {
                        currentOrder[idx] = {
                          ...currentOrder[idx],
                          forceSafePrice: true, // RECORDAR DECISIÓN [NO]
                          forceWholesale: false
                        };
                      }
                      return { order: currentOrder };
                    });
                  }
                }
              }
            );
          }

          // --- ACTUALIZACIÓN DEL CARRITO ---
          if (existingItemIndex >= 0) {
            const currentItem = order[existingItemIndex];
            const newQuantity = currentItem.quantity + 1;

            // Si ya tomamos una decisión (Wholesale/Safe), initialPrice ya tiene el valor correcto.
            // Si NO había conflicto, recalculamos el precio compuesto.
            let finalPrice = initialPrice;

            if (validation.status !== 'conflict') {
              finalPrice = calculateCompositePrice(currentItem, newQuantity);
            }

            const updatedOrder = [...order];
            updatedOrder[existingItemIndex] = {
              ...currentItem,
              quantity: newQuantity,
              price: finalPrice,
              exceedsStock: currentItem.trackStock && newQuantity > (currentItem.stock || 99999),
              priceWarning: isPriceWarning,
              // Si NO hay conflicto, reseteamos las banderas (por si bajó la cantidad y volvió a subir)
              forceWholesale: validation.status === 'conflict' ? (currentItem.forceWholesale || false) : false,
              forceSafePrice: validation.status === 'conflict' ? (currentItem.forceSafePrice || false) : false,
            };
            return { order: updatedOrder };

          } else {
            // Nuevo Item
            const newItem = {
              ...product,
              quantity: 1,
              price: initialPrice,
              originalPrice: product.price,
              exceedsStock: product.trackStock && 1 > product.stock,
              priceWarning: isPriceWarning,
              // Inicializamos banderas en falso
              forceWholesale: false,
              forceSafePrice: false
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
              const validation = validateWholesaleCondition(item, safeQuantity);

              let newPrice;
              let isPriceProtected = false;
              let shouldShowModal = false;

              // --- LÓGICA CON MEMORIA (UPDATE) ---
              if (validation.status === 'conflict') {
                isPriceProtected = true;

                if (item.forceWholesale) {
                  // Ya autorizado previamente -> Silencio
                  newPrice = validation.tierPrice;
                } else if (item.forceSafePrice) {
                  // Ya rechazado previamente -> Silencio
                  newPrice = validation.safePrice;
                } else {
                  // Conflicto nuevo -> Preguntar
                  newPrice = validation.safePrice; // Precio seguro mientras decide
                  shouldShowModal = true;
                }

                // Disparar modal solo si hay cantidad > 0 y no se ha decidido
                if (safeQuantity > 0 && shouldShowModal) {
                  showMessageModal(
                    `Al llevar ${safeQuantity} unidades, el precio baja a $${validation.tierPrice}, lo cual es menor al costo ($${validation.cost}).\n\n¿Autorizar precio bajo costo?`,
                    () => {
                      // CALLBACK SI (Autorizar)
                      set((innerState) => {
                        const innerOrder = innerState.order.map(i => {
                          if (i.id === itemId) {
                            return {
                              ...i,
                              price: validation.tierPrice,
                              forceWholesale: true, // RECORDAR
                              forceSafePrice: false
                            };
                          }
                          return i;
                        });
                        return { order: innerOrder };
                      });
                    },
                    {
                      title: '⚠️ Autorización de Costo',
                      type: 'warning',
                      confirmButtonText: 'Sí, Autorizar',
                      showCancel: false,
                      extraButton: {
                        text: 'No, Precio Regular',
                        action: () => {
                          // CALLBACK NO (Recordar negativa)
                          set((innerState) => {
                            const innerOrder = innerState.order.map(i => {
                              if (i.id === itemId) {
                                return {
                                  ...i,
                                  forceSafePrice: true, // RECORDAR
                                  forceWholesale: false
                                };
                              }
                              return i;
                            });
                            return { order: innerOrder };
                          });
                        }
                      }
                    }
                  );
                }
              } else {
                // SIN CONFLICTO
                newPrice = calculateCompositePrice(item, safeQuantity);
              }

              return {
                ...item,
                quantity: newQuantity,
                price: newPrice,
                exceedsStock: item.trackStock && safeQuantity > item.stock,
                priceWarning: isPriceProtected,
                // Reseteamos memoria si salimos de la zona de conflicto (ej. bajamos cantidad)
                forceWholesale: validation.status === 'conflict' ? item.forceWholesale : false,
                forceSafePrice: validation.status === 'conflict' ? item.forceSafePrice : false,
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