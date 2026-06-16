// src/components/pos/PosToast.jsx
import PropTypes from 'prop-types';
import { useEffect } from 'react';

/**
 * Componente para el toast no bloqueante del POS.
 * Muestra mensajes temporales en la parte inferior de la pantalla.
 */
export default function PosToast({ message, duration = 2000 }) {
    useEffect(() => {
        if (message) {
            const timer = setTimeout(() => {
                // El padre se encarga de limpiar el mensaje
            }, duration);
            return () => clearTimeout(timer);
        }
    }, [message, duration]);

    if (!message) return null;

    return (
        <div
            style={{
                position: 'fixed',
                top: 'max(20px, env(safe-area-inset-top, 0px))',
                left: '50%',
                transform: 'translateX(-50%)',
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                color: 'white',
                padding: '10px 20px',
                borderRadius: '30px',
                zIndex: 'var(--z-toast)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                fontSize: '0.9rem',
                fontWeight: '500',
                animation: 'fadeIn 0.2s ease-out',
                pointerEvents: 'none',
            }}
        >
            {message}
        </div>
    );
}

PosToast.propTypes = {
    message: PropTypes.string,
    duration: PropTypes.number
};
