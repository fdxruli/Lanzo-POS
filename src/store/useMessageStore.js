// src/store/useMessageStore.js
import { create } from 'zustand';

export const useMessageStore = create((set) => ({
  // --- ESTADO ---
  isOpen: false,
  message: '',
  onConfirm: null,
  options: {},

  // --- ACCIONES ---
  
  /**
   * Muestra el modal con un nuevo mensaje y configuración
   */
  show: (message, onConfirm = null, options = {}) => {
    set({
      isOpen: true,
      message,
      onConfirm,
      options
    });
  },

  /**
   * Cierra y resetea el modal
   */
  hide: () => {
    set({
      isOpen: false,
      message: '',
      onConfirm: null,
      options: {}
    });
  }
}));

// Exportamos una forma fácil de llamar al store
// sin necesidad de estar dentro de un componente de React.
// ¡Esta es la clave de la migración!
export const showMessage = (message, onConfirm = null, options = {}) => {
  useMessageStore.getState().show(message, onConfirm, options);
};