// src/hooks/usePosModals.js
import { useState, useEffect, useCallback } from 'react';

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
 *   closeCart: () => void
 * }}
 */
export function useMobileCartModal() {
    const [isOpen, setIsOpen] = useState(false);

    // ── Botón "Atrás" del navegador cierra el modal móvil ─────────
    useEffect(() => {
        if (isOpen) {
            window.history.pushState({ modal: 'cart' }, document.title);

            const handlePopState = () => {
                setIsOpen(false);
            };

            window.addEventListener('popstate', handlePopState);
            return () => window.removeEventListener('popstate', handlePopState);
        }
    }, [isOpen]);

    const openCart = useCallback(() => {
        setIsOpen(true);
    }, []);

    const closeCart = useCallback(() => {
        setIsOpen(false);
    }, []);

    return {
        isOpen,
        openCart,
        closeCart
    };
}
