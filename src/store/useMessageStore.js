// src/store/useMessageStore.js
import { create } from 'zustand';
import {
  actorRuntimeController,
  ACTOR_RUNTIME_STATUS
} from '../services/auth/actorRuntimeController';

export const useMessageStore = create((set) => ({
  // --- ESTADO ---
  isOpen: false,
  message: '',
  onConfirm: null,
  options: {},
  actorGeneration: null,

  // --- ACCIONES ---
  
  /**
   * Muestra el modal con un nuevo mensaje y configuración
   */
  show: (message, onConfirm = null, options = {}) => {
    const actor = actorRuntimeController.getState();
    set({
      isOpen: true,
      message,
      onConfirm,
      options,
      actorGeneration: actor.status === ACTOR_RUNTIME_STATUS.GRANTED
        ? actor.generation
        : null
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
      options: {},
      actorGeneration: null
    });
  }
}));

actorRuntimeController.subscribe((actor) => {
  const messageState = useMessageStore.getState();
  if (!messageState.isOpen || messageState.actorGeneration === null) return;
  if (
    actor.status === ACTOR_RUNTIME_STATUS.GRANTED
    && actor.generation === messageState.actorGeneration
  ) {
    return;
  }

  const onCancel = messageState.options?.onCancel;
  messageState.hide();
  onCancel?.();
});

// Exportamos una forma fácil de llamar al store
// sin necesidad de estar dentro de un componente de React.
// ¡Esta es la clave de la migración!
export const showMessage = (message, onConfirm = null, options = {}) => {
  useMessageStore.getState().show(message, onConfirm, options);
};
