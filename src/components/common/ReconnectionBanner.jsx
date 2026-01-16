import { useState, useEffect, useRef } from 'react';
import Logger from '../../services/Logger';
import { checkInternetConnection } from '../../services/utils';

export default function ReconnectionBanner() {
  const [showBanner, setShowBanner] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  
  // Usamos useRef para mantener el conteo entre renderizados y poder resetearlo
  const errorCountRef = useRef(0);

  // Función auxiliar para 'tocar' la actividad
  const refreshActivity = () => {
    sessionStorage.setItem('lanzo_last_active', Date.now().toString());
  };

  useEffect(() => {
    // 1. Escuchar errores de IndexedDB globalmente
    const handleError = (event) => {
      // Detectar errores específicos de BD desconectada o transacción fallida
      if (event.error?.name === 'InvalidStateError' || 
          event.error?.message?.includes('database') ||
          event.error?.message?.includes('transaction') ||
          event.error?.message?.includes('closed')) {
        
        errorCountRef.current = errorCountRef.current + 1;
        
        Logger.warn(`⚠️ Error de conexión detectado (${errorCountRef.current})`);

        if (errorCountRef.current >= 2) {
          setShowBanner(true);
        }
      }
    };

    window.addEventListener('error', handleError);

    // 2. Detectar inactividad (Loop de chequeo)
    const checkInactivity = setInterval(() => {
      const lastActive = sessionStorage.getItem('lanzo_last_active');
      const now = Date.now();
      
      // Si no existe registro, lo creamos ahora
      if (!lastActive) {
        refreshActivity();
        return;
      }

      // Si lleva más de 30 minutos (1800000 ms) inactiva
      if ((now - parseInt(lastActive)) > 1800000) {
        // Solo mostramos el banner si no se está mostrando ya
        setShowBanner(prev => {
          if (!prev) Logger.log("💤 Inactividad detectada, pausando conexión...");
          return true;
        });
      }
    }, 60000); // Chequear cada minuto

    // 3. Detectar actividad del usuario para prevenir desconexión mientras trabaja
    const handleUserActivity = () => {
        // Solo actualizamos si el banner NO está visible
        // Si el banner está visible, forzamos al usuario a dar clic en "Reconectar"
        if (!showBanner) {
            refreshActivity();
        }
    };

    // Escuchamos eventos comunes de interacción
    window.addEventListener('mousedown', handleUserActivity);
    window.addEventListener('keydown', handleUserActivity);
    window.addEventListener('touchstart', handleUserActivity);

    // Limpieza
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('mousedown', handleUserActivity);
      window.removeEventListener('keydown', handleUserActivity);
      window.removeEventListener('touchstart', handleUserActivity);
      clearInterval(checkInactivity);
    };
  }, [showBanner]); // Dependencia showBanner para el listener de actividad

  const handleReconnect = async () => {
    setIsReconnecting(true);
    
    try {
      // 1. Verificar si hay red antes de intentar nada complejo
      const isOnline = await checkInternetConnection();
      if (!isOnline) {
        alert('No se detecta conexión a internet. Verifica tu red.');
        setIsReconnecting(false);
        return;
      }

      Logger.log("🔄 Intentando reconexión de base de datos...");

      // 2. Cerrar y reabrir BD
      const { closeDB, initDB } = await import('../../services/database');
      
      try {
          closeDB();
      } catch (e) { console.warn("Error cerrando DB:", e); }
      
      await new Promise(r => setTimeout(r, 800)); // Damos un poco más de tiempo
      await initDB();
      
      // 3. Resetear estados y contadores
      errorCountRef.current = 0; // ¡Importante! Resetear contador de errores
      refreshActivity();         // ¡Importante! Actualizar timestamp para que no salga el banner en 1 min
      
      setShowBanner(false);
      setIsReconnecting(false);
      
      // Pequeño toast de éxito (opcional, podrías usar tu MessageModal si prefieres)
      // alert('✅ Conexión restaurada correctamente'); 
      Logger.log('✅ Conexión restaurada correctamente');
      
    } catch (error) {
      Logger.error('Error reconectando:', error);
      
      // Si falla, ofrecemos recargar
      if (confirm('La reconexión automática falló. ¿Deseas recargar la página para corregirlo? (Tus datos están seguros)')) {
        window.location.reload();
      }
      setIsReconnecting(false);
    }
  };

  const handleDismiss = () => {
    // Permitimos cerrar, pero reseteamos el tiempo para dar otros 30 mins
    refreshActivity();
    errorCountRef.current = 0;
    setShowBanner(false);
  };

  if (!showBanner) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      backgroundColor: '#f59e0b', // Amber-500
      color: 'white',
      padding: '12px 16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '16px',
      zIndex: 9999,
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      animation: 'slideDown 0.4s cubic-bezier(0.16, 1, 0.3, 1)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
        <span style={{ fontSize: '1.5rem', animation: 'pulse 2s infinite' }}>⚠️</span>
        <div style={{ flex: 1 }}>
          <strong style={{ display: 'block', marginBottom: '2px', fontSize: '0.95rem' }}>
            Conexión en Reposo
          </strong>
          <small style={{ opacity: 0.95, fontSize: '0.85rem' }}>
            La aplicación entró en modo ahorro por inactividad.
          </small>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px' }}>
        <button
          onClick={handleReconnect}
          disabled={isReconnecting}
          style={{
            backgroundColor: 'white',
            color: '#d97706', // Amber-600
            border: 'none',
            padding: '8px 16px',
            borderRadius: '6px',
            fontWeight: 600,
            fontSize: '0.9rem',
            cursor: isReconnecting ? 'not-allowed' : 'pointer',
            opacity: isReconnecting ? 0.7 : 1,
            whiteSpace: 'nowrap',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            transition: 'transform 0.1s'
          }}
        >
          {isReconnecting ? '⏳ Conectando...' : '⚡ Reactivar Sistema'}
        </button>

        <button
          onClick={handleDismiss}
          disabled={isReconnecting}
          style={{
            backgroundColor: 'transparent',
            border: '1px solid rgba(255,255,255,0.4)',
            color: 'white',
            width: '32px',
            height: '32px',
            borderRadius: '6px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.1rem'
          }}
          title="Posponer aviso"
        >
          ✕
        </button>
      </div>

      <style>{`
        @keyframes slideDown {
          from { transform: translateY(-100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.1); }
          100% { transform: scale(1); }
        }
      `}</style>
    </div>
  );
}