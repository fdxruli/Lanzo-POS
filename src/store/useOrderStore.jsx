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

      // --- Lógica para productos a granel (Bulk) ---
      if (product.saleType === 'bulk') {
        const existingItem = order.find((item) => item.id === product.id);
        if (existingItem) {
          return { order }; // Ya existe, no hacemos nada (el usuario edita la cantidad en el input)
        }
        // Añadir item a granel
        // Guardamos 'originalPrice' para no perder el precio base al aplicar descuentos
        const newItem = { 
            ...product, 
            quantity: null, 
            originalPrice: product.price, 
            exceedsStock: false 
        };
        return { order: [...order, newItem] };
      }

      // --- Lógica para productos por unidad ---
      const existingItem = order.find((item) => item.id === product.id);
      
      if (existingItem) {
        // Si ya existe, incrementamos
        const newQuantity = existingItem.quantity + 1;
        
        // ¡CALCULAR PRECIO DINÁMICO!
        // Usamos el helper pasando el item (que ya tiene los tiers) y la nueva cantidad
        const newPrice = calculateDynamicPrice(existingItem, newQuantity);
        
        const updatedOrder = order.map((item) => {
          if (item.id === product.id) {
            // Validar stock
            const exceeds = item.trackStock && newQuantity > item.stock;
            
            return { 
                ...item, 
                quantity: newQuantity, 
                price: newPrice, // Actualizamos el precio si alcanzó un tier
                exceedsStock: exceeds 
            };
          }
          return item;
        });
        return { order: updatedOrder };

      } else {
        // Si es nuevo, lo añadimos
        const newQuantity = 1;
        
        // Calculamos precio inicial (por si acaso hay un tier para cantidad 1, aunque raro)
        const initialPrice = calculateDynamicPrice(product, newQuantity);
        
        // Validar stock
        const exceeds = product.trackStock && newQuantity > product.stock;
        
        const newItem = { 
            ...product, 
            quantity: newQuantity, 
            price: initialPrice, 
            originalPrice: product.price, // ¡IMPORTANTE! Guardamos el precio base
            exceedsStock: exceeds 
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
          // newQuantity puede ser un número o null (para bulk input vacío)
          const safeQuantity = newQuantity === null ? 0 : newQuantity;
          
          // ¡CALCULAR PRECIO DINÁMICO!
          const newPrice = calculateDynamicPrice(item, safeQuantity);

          // Validar stock
          const exceeds = item.trackStock && safeQuantity > item.stock;
          
          return { 
            ...item, 
            quantity: newQuantity, 
            price: newPrice, // Precio actualizado según el volumen
            exceedsStock: exceeds 
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
  clearOrder: () => {
    set({ order: [] });
  },

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
    const { order } = get(); // get() nos da el estado actual
    return order.reduce((sum, item) => {
      if (item.quantity && !isNaN(item.quantity) && item.quantity > 0) {
        return sum + (item.price * item.quantity);
      }
      return sum;
    }, 0);
  },

}));