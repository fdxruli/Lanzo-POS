/**
 * PersistenceWarningBanner - Banner crítico de modo volátil
 *
 * Se muestra como barra fija en la parte superior cuando los datos NO están
 * protegidos contra evicción del navegador (isVolatile === true).
 *
 * Comportamiento Refactorizado (Fase 3):
 * - Ya no gestiona respaldos. Su única meta es proteger el entorno.
 * - Bloqueo Estricto: Si isCritical === true, se bloquea la app con un overlay opaco.
 * - Si el usuario cierra el banner volátil, informa al estado global para mostrar ⚠️ en el Navbar.
 */

import { useEffect, useState, useCallback } from 'react';
import { AlertCircle, ShieldAlert, Lock, Loader, X, Apple, Flame, Chrome, Waves, Globe } from 'lucide-react';
import usePersistentStorage from '../../hooks/usePersistentStorage';
import { storageManager } from '../../services/storageManager';
import { useAppStore } from '../../store/useAppStore';
import Logger from '../../services/Logger';
import './PersistenceWarningBanner.css';
import { downloadBackupSmart } from '../../services/dataTransfer';
import { showMessageModal } from '../../services/utils';

function detectBrowser() {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
  const isFirefox = /firefox/i.test(ua);
  const isChrome = /chrome/i.test(ua) && !/edge/i.test(ua);
  const isEdge = /edge/i.test(ua);

  if (isIOS || isSafari) return 'safari';
  if (isFirefox) return 'firefox';
  if (isEdge) return 'edge';
  if (isChrome) return 'chrome';
  return 'other';
}

const INSTRUCTIONS = {
  safari: { icon: <Apple size={18} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'text-bottom' }} />, steps: 'Toca Compartir → "Agregar a pantalla de inicio" para proteger tus datos.' },
  firefox: { icon: <Flame size={18} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'text-bottom', color: '#f97316' }} />, steps: 'Instala la app: menú ⋯ → "Instalar" o visita el sitio frecuentemente.' },
  chrome: { icon: <Chrome size={18} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'text-bottom' }} />, steps: 'Instala la app: menú ⋮ → "Instalar aplicación" o "Agregar a pantalla de inicio".' },
  edge: { icon: <Waves size={18} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'text-bottom', color: '#3b82f6' }} />, steps: 'Instala la app: menú … → "Aplicaciones" → "Instalar este sitio".' },
  other: { icon: <Globe size={18} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'text-bottom' }} />, steps: 'Instala la app como PWA desde el menú de tu navegador para proteger tus datos.' },
};

// Sub-componente de bloqueo duro
const CriticalStorageLockScreen = () => {
  const isBackupLoading = useAppStore(state => state.isBackupLoading);
  const setBackupLoading = useAppStore(state => state.setBackupLoading);

  const handleEmergencyBackup = async () => {
    setBackupLoading(true);
    try {
      await downloadBackupSmart();
      showMessageModal('Respaldo de emergencia completado. Ahora libera espacio en tu dispositivo.');
    } catch (e) {
      showMessageModal('Fallo al respaldar.', null, { type: 'error' });
    } finally {
      setBackupLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
      background: 'rgba(0,0,0,0.95)', color: '#fff', zIndex: 'var(--z-critical-blocker)',
      display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
      padding: '2rem', textAlign: 'center', fontFamily: 'sans-serif'
    }}>
      <AlertCircle color="#ff4444" size={64} style={{ marginBottom: '1rem' }} />
      <h1 style={{ color: '#ff4444', marginBottom: '1rem' }}>Operación Pausada: Almacenamiento Crítico</h1>
      <p style={{ fontSize: '1.25rem', maxWidth: '600px', lineHeight: '1.5', color: '#e5e7eb', marginBottom: '2rem' }}>
        El disco duro de este dispositivo está casi lleno. Continuar operando el Punto de Venta en este estado provocará corrupción o pérdida silenciosa de datos de ventas.
      </p>
      <div style={{ background: '#450a0a', padding: '1.5rem', borderRadius: '8px', border: '1px solid #7f1d1d' }}>
        <p style={{ margin: 0, color: '#fca5a5', fontWeight: 'bold' }}>
          Por favor, libera espacio en el disco duro o haz un respaldo inmediato desde la configuración, luego recarga la página.
        </p>
      </div>
      <button
        onClick={handleEmergencyBackup}
        disabled={isBackupLoading}
        style={{ marginTop: '1rem', padding: '1rem 2rem', fontSize: '1.2rem', background: '#dc2626', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}
      >
        {isBackupLoading ? 'Generando...' : 'Descargar Respaldo de Emergencia'}
      </button>
    </div>
  );
};

export const PersistenceWarningBanner = () => {
  const { isVolatile, isCritical, persistenceState, isRequestingPersistence } = usePersistentStorage();
  const [browser] = useState(() => detectBrowser());
  const [deferredPrompt, setDeferredPrompt] = useState(null);

  const setStorageCritical = useAppStore(state => state.setStorageCritical);
  const isVolatileDismissed = useAppStore(state => state.isVolatileDismissed);
  const setVolatileDismissed = useAppStore(state => state.setVolatileDismissed);

  // Capturar el evento de instalación PWA
  useEffect(() => {
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const handleInstall = useCallback(async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      Logger.info(`PWA install prompt result: ${outcome}`);
      setDeferredPrompt(null);
    }
  }, [deferredPrompt]);

  const handleRequestPersistence = useCallback(async () => {
    try {
      await storageManager.requestPersistence();
    } catch (err) {
      Logger.error('Error requesting persistence:', err);
    }
  }, []);

  // Control estricto de bloqueo (Bloqueo Duro)
  useEffect(() => {
    setStorageCritical(isCritical);
    // Si se vuelve crítico, forzamos a que reaparezca
    if (isCritical) {
      setVolatileDismissed(false);
    }
  }, [isCritical, setStorageCritical, setVolatileDismissed]);

  if (isCritical) {
    return <CriticalStorageLockScreen />;
  }

  // Si no hay riesgo volátil, o si el usuario lo ocultó, no renderizamos el banner grande.
  // (El ícono flotante se maneja en el Navbar)
  if (!isVolatile || isVolatileDismissed) return null;

  const instruction = INSTRUCTIONS[browser];
  const isDenied = persistenceState === 'denied' || persistenceState === 'unsupported';
  const canRetry = persistenceState === 'prompt' || persistenceState === 'unknown';

  return (
    <div className="persistence-warning-banner" role="alert" aria-live="polite">
      <div className="banner-content">
        <div className="banner-icon" aria-hidden="true">
          <ShieldAlert size={28} />
        </div>
        <div className="banner-text">
          <strong>Datos sin protección — Riesgo de pérdida</strong>
          <p>
            Tus datos viven solo en este dispositivo y pueden borrarse si el navegador libera espacio.
            {isDenied && <> {instruction.icon} {instruction.steps}</>}
          </p>
        </div>
      </div>

      <div className="banner-actions">
        {deferredPrompt && (
          <button
            className="banner-btn banner-btn--secondary"
            onClick={handleInstall}
            title="Instalar como aplicación para proteger datos"
          >
            Instalar app
          </button>
        )}

        {canRetry && !isRequestingPersistence && (
          <button
            className="banner-btn banner-btn--secondary"
            onClick={handleRequestPersistence}
            title="Solicitar permiso de almacenamiento persistente"
            style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <Lock size={16} /> Proteger datos
          </button>
        )}

        {isRequestingPersistence && (
          <span className="banner-status" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Loader size={16} className="animate-spin" /> Solicitando...
          </span>
        )}

        <button
          className="banner-btn banner-btn--dismiss"
          onClick={() => setVolatileDismissed(true)}
          title="Cerrar"
          aria-label="Cerrar aviso de almacenamiento"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
};

export default PersistenceWarningBanner;
