// src/hooks/usePosModals.js
import { useState, useCallback } from 'react';
import { useDismissibleHistoryLayer } from '../useDismissibleHistoryLayer';

/**
 * Máquina de estados para los modales del POS.
 * Reemplaza múltiples useState booleanos por un estado unificado.
 * 
 * @returns {{
 *   activeModal: 'scanner' | 'payment' | 'quickCaja' | 'prescription' | 'layaway' | 'tables' | 'split' | 'mobileCart' | null,
 *   openModal: (modal: string) => void,
 *   closeModal: (modal?: string) => void,
 *   isModalOpen: (modal: string) => boolean
 * }}
 */
export function usePosModals() {
    const [activeModal, setActiveModal] = useState(null);

    const openModal = useCallback((modalName) => {
        setActiveModal(modalName);
    }, []);

    const closeModal = useCallback((modalName) => {
        setActiveModal((current) => {
            // Si no se especifica nombre, cerrar siempre
            if (!modalName) return null;
            // Solo cerrar si coincide con el activo
            return current === modalName ? null : current;
        });
    }, []);

    const isModalOpen = useCallback(
        (modalName) => activeModal === modalName,
        [activeModal]
    );

    return {
        activeModal,
        openModal,
        closeModal,
        isModalOpen
    };
}

/**
 * Hook especializado para el modal móvil con navegación por historial.
 * El modal móvil necesita manejar window.history.pushState para el botón "Atrás".
 * 
 * @returns {{
 *   isOpen: boolean,
 *   openCart: () => void,
 *   closeCart: () => void,
 *   closeCartForModalTransition: () => void
 * }}
 */
export function useMobileCartModal() {
    const [isOpen, setIsOpen] = useState(false);

    const handleDismiss = useCallback(() => {
        setIsOpen(false);
    }, []);

    const closeCart = useDismissibleHistoryLayer({
        isOpen,
        onDismiss: handleDismiss,
        layerId: 'mobile-cart'
    });

    const openCart = useCallback(() => {
        setIsOpen(true);
    }, []);

    const closeCartForModalTransition = useCallback(() => {
        closeCart({ handoffHistory: true });
    }, [closeCart]);

    return {
        isOpen,
        openCart,
        closeCart,
        closeCartForModalTransition
    };
}
