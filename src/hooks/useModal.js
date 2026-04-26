// src/hooks/useModal.js
import { useState, useCallback, useRef } from 'react';

/**
 * Hook personalizado para manejo genérico de modales con focus management automático
 * 
 * @returns {Object} Objeto con estado y métodos del modal
 * @property {boolean} isOpen - Estado de visibilidad del modal
 * @property {Function} open - Abre el modal y guarda el foco actual
 * @property {Function} close - Cierra el modal y restaura el foco
 * @property {Function} toggle - Alterna el estado del modal
 * @property {Object} previousFocusRef - Ref al elemento con foco antes de abrir el modal
 * 
 * @example
 * const { isOpen, open, close } = useModal();
 * 
 * return (
 *   <>
 *     <button onClick={open}>Abrir Modal</button>
 *     {isOpen && <Modal onClose={close}>Contenido</Modal>}
 *   </>
 * );
 */
export const useModal = () => {
  const [isOpen, setIsOpen] = useState(false);
  const previousFocusRef = useRef(null);

  const open = useCallback(() => {
    // Guardar el elemento actualmente enfocado antes de abrir el modal
    previousFocusRef.current = document.activeElement;
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    
    // Restaurar foco al elemento original para accesibilidad
    // Verificación defensiva para evitar errores si el elemento ya no existe
    if (previousFocusRef.current && typeof previousFocusRef.current.focus === 'function') {
      previousFocusRef.current.focus();
    }
  }, []);

  const toggle = useCallback(() => {
    if (isOpen) {
      close();
    } else {
      open();
    }
  }, [isOpen, open, close]);

  return { 
    isOpen, 
    open, 
    close, 
    toggle, 
    previousFocusRef 
  };
};
