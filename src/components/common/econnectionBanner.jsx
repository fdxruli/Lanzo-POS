import { useState, useEffect } from 'react';

export default function ReconnectionBanner() {
  const [showBanner, setShowBanner] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);

  useEffect(() => {
    let errorCount = 0;
    
    // Escuchar errores de IndexedDB globalmente
    const handleError = (event) => {
      // Detectar errores específicos de BD desconectada
      if (event.error?.name === 'InvalidStateError' || 
          event.error?.message?.includes('database') ||
          event.error?.message?.includes('transaction')) {
        errorCount++;
        
        if (errorCount >= 2) {
          setShowBanner(true);
        }
      }
    };

    window.addEventListener('error', handleError);
    
    // También detectar si la app lleva mucho tiempo sin actividad
    const checkInactivity = setInterval(() => {
      const lastActive = sessionStorage.getItem('lanzo_last_active');
      const now = Date.now();
      
      // Si lleva más de 30 minutos inactiva y volvemos, sugerimos reconexión
      if (lastActive && (now - parseInt(lastActive)) > 1800000) {
        setShowBanner(true);
      }
    }, 60000); // Chequear cada minuto

    return () => {
      window.removeEventListener('error', handleError);
      clearInterval(checkInactivity);
    };
  }, []);

  const handleReconnect = async () => {
    setIsReconnecting(true);
    
    try {
      // Cerrar y reabrir BD
      const { closeDB, initDB } = await import('../services/database');
      closeDB();
      
      await new Promise(r => setTimeout(r, 500));
      await initDB();
      
      setShowBanner(false);
      setIsReconnecting(false);
      
      // Pequeño toast de éxito
      alert('✅ Conexión restaurada correctamente');
      
    } catch (error) {
      console.error('Error reconectando:', error);
      
      // Si falla, ofrecemos recargar
      if (confirm('La reconexión falló. ¿Recargar la página? (Se guardarán tus datos)')) {
        window.location.reload();
      }
      setIsReconnecting(false);
    }
  };

  const handleDismiss = () => {
    setShowBanner(false);
    sessionStorage.setItem('lanzo_last_active', Date.now().toString());
  };

  if (!showBanner) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      backgroundColor: '#f59e0b',
      color: 'white',
      padding: '12px 16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '16px',
      zIndex: 9999,
      boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
      animation: 'slideDown 0.3s ease-out'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
        <span style={{ fontSize: '1.5rem' }}>⚠️</span>
        <div style={{ flex: 1 }}>
          <strong style={{ display: 'block', marginBottom: '4px' }}>
            Conexión Pausada
          </strong>
          <small style={{ opacity: 0.9 }}>
            La aplicación estuvo inactiva. Reconecta para usar todas las funciones.
          </small>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={handleReconnect}
          disabled={isReconnecting}
          style={{
            backgroundColor: 'white',
            color: '#f59e0b',
            border: 'none',
            padding: '8px 16px',
            borderRadius: '6px',
            fontWeight: 600,
            cursor: isReconnecting ? 'not-allowed' : 'pointer',
            opacity: isReconnecting ? 0.7 : 1,
            whiteSpace: 'nowrap'
          }}
        >
          {isReconnecting ? '⏳ Reconectando...' : '🔄 Reconectar'}
        </button>

        <button
          onClick={handleDismiss}
          disabled={isReconnecting}
          style={{
            backgroundColor: 'transparent',
            border: '1px solid white',
            color: 'white',
            padding: '8px 12px',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '1.2rem',
            lineHeight: 1
          }}
          title="Cerrar aviso"
        >
          ✕
        </button>
      </div>

      <style>{`
        @keyframes slideDown {
          from {
            transform: translateY(-100%);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
