import React from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw, X } from 'lucide-react';

const CHECK_INTERVAL_MS = 60 * 60 * 1000; 

const UpdatePrompt = () => {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(registration) {
      if (!registration) return;

      setInterval(() => {
        if (navigator.onLine) {
          registration.update().catch((error) => {
            console.error('Fallo al buscar actualización PWA:', error);
          });
        }
      }, CHECK_INTERVAL_MS);
    },
    onRegisterError(error) {
      console.error('Fallo crítico en registro de SW:', error);
    },
  });

  if (!needRefresh) return null;

  return (
    <div style={{
      position: 'fixed', 
      bottom: '20px', 
      right: '20px', 
      zIndex: 'var(--z-toast)',
      backgroundColor: 'var(--card-background-color)', 
      color: 'var(--text-color)', 
      padding: 'var(--spacing-md)',
      borderRadius: 'var(--border-radius)', 
      boxShadow: 'var(--box-shadow-lg)',
      border: '1px solid var(--border-color)',
      display: 'flex', 
      flexDirection: 'column', 
      gap: 'var(--spacing-sm)', 
      maxWidth: '300px'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <h4 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-dark)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          ✨ Nueva versión disponible
        </h4>
        <button 
          onClick={() => setNeedRefresh(false)}
          style={{ 
            background: 'none', 
            border: 'none', 
            color: 'var(--text-light)', 
            cursor: 'pointer',
            padding: '2px'
          }}
          aria-label="Cerrar notificación"
        >
          <X size={18} />
        </button>
      </div>
      <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-color)' }}>
        Guarda tu venta actual y actualiza para aplicar los cambios en el sistema.
      </p>
      
      {/* Usando tu clase global btn-primary */}
      <button
        className="btn-primary"
        onClick={() => updateServiceWorker(true)}
        style={{ marginTop: 'var(--spacing-xs)' }}
      >
        <RefreshCw size={16} />
        Actualizar ahora
      </button>
    </div>
  );
};

export default UpdatePrompt;