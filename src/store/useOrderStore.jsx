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
          return { order }; // Ya existe, no hacemos nada
        }
        // Añadir item a granel (exceedsStock se validará al poner cantidad)
        const newItem = { ...product, quantity: null, exceedsStock: false };
        return { order: [...order, newItem] };
      }

      // Lógica para productos por unidad
      const existingItem = order.find((item) => item.id === product.id);
      
      if (existingItem) {
        // Si ya existe, incrementamos y validamos stock
        const updatedOrder = order.map((item) => {
          if (item.id === product.id) {
            const newQuantity = item.quantity + 1;
            // ¡VALIDACIÓN AÑADIDA!
            const exceeds = item.trackStock && newQuantity > item.stock;
            return { ...item, quantity: newQuantity, exceedsStock: exceeds };
          }
          return item;
        });
        return { order: updatedOrder };
      } else {
        // Si es nuevo, lo añadimos y validamos stock
        const newQuantity = 1;
        // ¡VALIDACIÓN AÑADIDA!
        const exceeds = product.trackStock && newQuantity > product.stock;
        const newItem = { ...product, quantity: newQuantity, exceedsStock: exceeds };
        return { order: [...order, newItem] };
      }
    });
  },

  /**
   * Actualiza la cantidad de un item (para +/- o input a granel).
   * ¡CORREGIDO! Ahora comprueba el stock.
   */
  updateItemQuantity: (productId, newQuantity) => {
    set((state) => {
      const updatedOrder = state.order.map((item) => {
        if (item.id === productId) {
          // newQuantity puede ser un número o null (para bulk input)
          const safeQuantity = newQuantity === null ? 0 : newQuantity;
          // ¡VALIDACIÓN AÑADIDA!
          const exceeds = item.trackStock && safeQuantity > item.stock;
          return { ...item, quantity: newQuantity, exceedsStock: exceeds };
        }
        return item;
      });
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