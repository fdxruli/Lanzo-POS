/**
 * PersistenceWarningBanner - Banner crítico de modo volátil
 *
 * Se muestra como barra fija en la parte superior cuando los datos NO están
 * protegidos contra evicción del navegador (isVolatile === true).
 *
 * Comportamiento:
 * - El usuario puede cerrarlo, pero reaparece en la próxima sesión si el riesgo persiste
 * - En modo crítico (almacenamiento lleno) NO se puede cerrar
 * - Detecta el navegador/OS y muestra instrucciones específicas
 * - Incluye botón para hacer respaldo inmediato
 * - Se oculta automáticamente si la persistencia es concedida
 */

import { useEffect, useState, useCallback } from 'react';
import usePersistentStorage from '../../hooks/usePersistentStorage';
import { storageManager } from '../../services/storageManager';
import {
  downloadBackupSmart,
  BACKUP_ABORT_REASON,
} from '../../services/dataTransfer';
import Logger from '../../services/Logger';
import './PersistenceWarningBanner.css';

/**
 * Detecta el navegador/OS para mostrar instrucciones correctas
 */
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
  safari: {
    icon: '🍎',
    steps: 'Toca Compartir → "Agregar a pantalla de inicio" para proteger tus datos.',
  },
  firefox: {
    icon: '🦊',
    steps: 'Instala la app: menú ⋯ → "Instalar" o visita el sitio frecuentemente.',
  },
  chrome: {
    icon: '🌐',
    steps: 'Instala la app: menú ⋮ → "Instalar aplicación" o "Agregar a pantalla de inicio".',
  },
  edge: {
    icon: '🌊',
    steps: 'Instala la app: menú … → "Aplicaciones" → "Instalar este sitio".',
  },
  other: {
    icon: '🌐',
    steps: 'Instala la app como PWA desde el menú de tu navegador para proteger tus datos.',
  },
};

export const PersistenceWarningBanner = () => {
  const { isVolatile, isCritical, persistenceState, isRequestingPersistence, requestPersistence } =
    usePersistentStorage();
  const [dismissed, setDismissed] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [browser] = useState(() => detectBrowser());
  const [deferredPrompt, setDeferredPrompt] = useState(null);

  // Capturar el evento de instalación PWA (Chrome/Edge/Firefox)
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

  const handleBackup = useCallback(async () => {
    if (isBackingUp) return;
    setIsBackingUp(true);
    try {
      const result = await downloadBackupSmart();
      if (result.success) {
        Logger.info('Respaldo generado correctamente desde banner de persistencia');
      } else if (result.reason !== BACKUP_ABORT_REASON) {
        alert('No se pudo generar el respaldo. Intenta desde Configuración → Respaldo.');
      }
    } catch (err) {
      Logger.error('Error en respaldo desde banner:', err);
      alert('Error al generar respaldo. Intenta de nuevo.');
    } finally {
      setIsBackingUp(false);
    }
  }, [isBackingUp]);

  // Si pasa a estado crítico (disco lleno), re-mostrar aunque el usuario lo haya cerrado
  useEffect(() => {
    if (isCritical) setDismissed(false);
  }, [isCritical]);

  // No mostrar si no hay problema, o si el usuario lo cerró (excepto crítico)
  if ((!isVolatile && !isCritical) || dismissed) return null;

  const instruction = INSTRUCTIONS[browser];
  const isDenied = persistenceState === 'denied' || persistenceState === 'unsupported';
  const canRetry = persistenceState === 'prompt' || persistenceState === 'unknown';

  return (
    <div
      className={`persistence-warning-banner ${isCritical ? 'is-critical' : ''}`}
      role="alert"
      aria-live="polite"
    >
      <div className="banner-content">
        <div className="banner-icon" aria-hidden="true">
          {isCritical ? '🔴' : '🛡️'}
        </div>
        <div className="banner-text">
          <strong>
            {isCritical
              ? 'Almacenamiento Crítico — Haz un respaldo ahora'
              : 'Datos sin protección — Riesgo de pérdida'}
          </strong>
          <p>
            {isCritical
              ? 'El disco está casi lleno. Las ventas pueden fallar al guardarse.'
              : 'Tus datos viven solo en este dispositivo y pueden borrarse si el navegador libera espacio.'}
            {isDenied && !isCritical && (
              <> {instruction.icon} {instruction.steps}</>
            )}
          </p>
        </div>
      </div>

      <div className="banner-actions">
        {/* Botón de respaldo — siempre disponible */}
        <button
          id="persistence-banner-backup-btn"
          className="banner-btn banner-btn--primary"
          onClick={handleBackup}
          disabled={isBackingUp}
          title="Descargar copia de seguridad completa"
        >
          {isBackingUp ? '⏳ Respaldando...' : '💾 Respaldar ahora'}
        </button>

        {/* Botón de instalación PWA si el navegador lo soporta */}
        {deferredPrompt && (
          <button
            id="persistence-banner-install-btn"
            className="banner-btn banner-btn--secondary"
            onClick={handleInstall}
            title="Instalar como aplicación para proteger datos"
          >
            📲 Instalar app
          </button>
        )}

        {/* Reintentar persistencia si aún hay posibilidad */}
        {canRetry && !isRequestingPersistence && (
          <button
            id="persistence-banner-persist-btn"
            className="banner-btn banner-btn--secondary"
            onClick={handleRequestPersistence}
            title="Solicitar permiso de almacenamiento persistente"
          >
            🔒 Proteger datos
          </button>
        )}

        {isRequestingPersistence && (
          <span className="banner-status">⏳ Solicitando...</span>
        )}

        {/* Botón de cierre — solo en modo no-crítico.
            El banner reaparece en la próxima sesión si el riesgo persiste. */}
        {!isCritical && (
          <button
            id="persistence-banner-dismiss-btn"
            className="banner-btn banner-btn--dismiss"
            onClick={() => setDismissed(true)}
            title="Cerrar (reaparecerá en la próxima sesión)"
            aria-label="Cerrar aviso de almacenamiento"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
};

export default PersistenceWarningBanner;
