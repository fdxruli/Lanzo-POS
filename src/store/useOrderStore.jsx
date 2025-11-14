import { create } from 'zustand';

// create() crea un "almacén" (store).
// set es una función para actualizar el estado.
// get es una función para leer el estado (útil dentro de las acciones).
export const useOrderStore = create((set, get) => ({
  
  // ======================================================
  // 1. EL ESTADO (TU ANTIGUA VARIABLE 'order')
  // ======================================================
  order: [], // El estado inicial es un array vacío

  // ======================================================
  // 2. LAS ACCIONES (TUS ANTIGUAS FUNCIONES EN APP.JS)
  // ======================================================

  /**
   * Añade un producto al pedido.
   * Reemplaza la lógica de 'addItemToOrder' en app.js
   */
  addItem: (product) => {
    set((state) => {
      const { order } = state;

      // Lógica para productos a granel
      if (product.saleType === 'bulk') {
        const existingItem = order.find((item) => item.id === product.id);
        if (existingItem) {
          // El producto a granel ya está, no hacemos nada más
          // (el usuario editará la cantidad manualmente)
          return { order };
        }
        // Añadir item a granel con cantidad nula para que el usuario la ingrese
        const newItem = { ...product, quantity: null, exceedsStock: false };
        return { order: [...order, newItem] };
      }

      // Lógica para productos por unidad
      const existingItem = order.find((item) => item.id === product.id);
      
      if (existingItem) {
        // Si ya existe, solo incrementamos la cantidad
        const updatedOrder = order.map((item) =>
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
        return { order: updatedOrder };
      } else {
        // Si es nuevo, lo añadimos con cantidad 1
        const newItem = { ...product, quantity: 1, exceedsStock: false };
        return { order: [...order, newItem] };
      }
    });
  },

  /**
   * Actualiza la cantidad de un item (para +/- o input a granel).
   * Reemplaza 'handleQuantityChange' y 'handleBulkQuantityInput'
   */
  updateItemQuantity: (productId, newQuantity) => {
    set((state) => {
      const updatedOrder = state.order.map((item) =>
        item.id === productId ? { ...item, quantity: newQuantity } : item
      );
      return { order: updatedOrder };
    });
  },

  /**
   * Elimina un item del pedido.
   * Reemplaza 'handleRemoveItem'
   */
  removeItem: (productId) => {
    set((state) => ({
      order: state.order.filter((item) => item.id !== productId),
    }));
  },

  /**
   * Vacía el pedido completo.
   * Reemplaza la lógica del 'clear-order-btn'
   */
  clearOrder: () => {
    set({ order: [] });
  },

  /**
   * Sobrescribe el pedido (útil para el scanner).
   * Reemplaza 'addMultipleItemsToOrder'
   */
  setOrder: (newOrder) => {
    set({ order: newOrder });
  },

  // ======================================================
  // 3. (Opcional) Funciones "Getter" para estado derivado
  // ======================================================
  
  /**
   * Calcula el total. Reemplaza 'calculateTotals'
   * Lo llamaremos desde el componente.
   */
  getTotalPrice: () => {
    const { order } = get(); // get() nos da el estado actual
    return order.reduce((sum, item) => {
      if (item.quantity && !isNaN(item.quantity) && item.quantity > 0) {
        return sum + (item.price * item.quantity);
      }
      return sum;
    }, 0);
  },

}));