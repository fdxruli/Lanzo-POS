import React from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw, X } from 'lucide-react';

// Intervalo estricto: Busca actualizaciones cada 1 hora
const CHECK_INTERVAL_MS = 60 * 60 * 1000; 

const UpdatePrompt = () => {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(registration) {
      if (!registration) return;

      // Sondeo periódico: Obliga al navegador a checar el servidor
      // independientemente de si el usuario recarga la página o no.
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
      position: 'fixed', bottom: '20px', right: '20px', zIndex: 9999,
      backgroundColor: '#1e293b', color: 'white', padding: '16px',
      borderRadius: '8px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
      display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '300px'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: '500' }}>
          ✨ Nueva versión disponible
        </p>
        <button 
          onClick={() => setNeedRefresh(false)}
          style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
          aria-label="Cerrar notificación"
        >
          <X size={16} />
        </button>
      </div>
      <p style={{ margin: 0, fontSize: '0.8rem', color: '#cbd5e1' }}>
        Guarda tu venta actual y actualiza para aplicar los cambios en el sistema.
      </p>
      <button
        onClick={() => updateServiceWorker(true)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
          backgroundColor: '#3b82f6', color: 'white', border: 'none',
          padding: '8px', borderRadius: '6px', cursor: 'pointer', fontWeight: '600'
        }}
      >
        <RefreshCw size={16} />
        Actualizar ahora
      </button>
    </div>
  );
};

export default UpdatePrompt;