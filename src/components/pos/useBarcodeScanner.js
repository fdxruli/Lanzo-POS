// src/hooks/useBarcodeScanner.js
import { useEffect } from 'react';

/**
 * Hook para manejar el escáner de código de barras (teclado físico).
 * Detecta patrones de escaneo basados en timing entre teclas.
 * 
 * @param {function} onScan - Callback que recibe el código escaneado
 * @returns {{ cleanup: function }} - Función para limpiar el listener manualmente si es necesario
 */
export function useBarcodeScanner(onScan) {
    useEffect(() => {
        let buffer = '';
        let lastKeyTime = Date.now();

        const handleKeyDown = async (e) => {
            // Ignorar si el foco está en un input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                return;
            }

            const char = e.key;
            const currentTime = Date.now();

            // Resetear buffer si pasa más de 100ms entre teclas
            if (currentTime - lastKeyTime > 100) {
                buffer = '';
            }
            lastKeyTime = currentTime;

            if (char === 'Enter') {
                if (buffer.length > 2) {
                    e.preventDefault();
                    await onScan(buffer);
                }
                buffer = '';
            } else if (char.length === 1) {
                buffer += char;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [onScan]);

    return { cleanup: () => {} };
}
