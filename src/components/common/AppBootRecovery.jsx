import { useEffect, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, Check, Copy, Mail, RefreshCw } from 'lucide-react';
import { APP_VERSION_LABEL } from '../../config/appVersion';
import { createRecoveryContextGuard } from '../../services/diagnostics/recoveryContext';
import { getActorCheckoutOwnerships, getPendingActorOperations } from '../../services/auth/actorOperationalHandoff';
import {
  buildAdminBootSupportReport,
  buildSupportMailtoUrl,
  copyTextToClipboard
} from '../../services/support/supportContact';
import {
  getAdminUpdateCheckState,
  requestAdminServiceWorkerUpdateCheck,
  subscribeAdminUpdateCheck
} from '../../pwa/adminServiceWorkerUpdateMonitor';
import {
  activateAdminServiceWorkerUpdate,
  getAdminServiceWorkerState,
  reloadAdminWebUpdate,
  subscribeAdminServiceWorker
} from '../../pwa/adminServiceWorker';

const UPDATE_MESSAGES = {
  checking: 'Comprobando si hay una versión nueva…',
  current: 'La versión publicada coincide con esta instalación. Si no puedes iniciar, consulta el diagnóstico o soporte.',
  available: 'Hay una versión nueva disponible.',
  pending: 'La actualización está pendiente de aplicarse.',
  offline: 'Necesitas conexión para comprobar actualizaciones.',
  error: 'No pudimos comprobar las actualizaciones. Inténtalo con conexión.',
};

const readRecoverySafety = (isContextCurrent) => {
  try {
    return {
      contextCurrent: isContextCurrent() === true,
      operationsIdle: getActorCheckoutOwnerships().length === 0 && getPendingActorOperations().length === 0
    };
  } catch {
    return { contextCurrent: false, operationsIdle: false };
  }
};

export default function AppBootRecovery() {
  const [isContextCurrent] = useState(() => {
    const guard = createRecoveryContextGuard();
    return () => {
      try { return guard() === true; } catch { return false; }
    };
  });
  const [safety, setSafety] = useState(() => readRecoverySafety(isContextCurrent));
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  const [hasChecked, setHasChecked] = useState(false);
  const [checkBusy, setCheckBusy] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [updateNotice, setUpdateNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const [worker, setWorker] = useState(getAdminServiceWorkerState);
  const check = useSyncExternalStore(
    subscribeAdminUpdateCheck,
    getAdminUpdateCheckState,
    getAdminUpdateCheckState
  );

  useEffect(() => {
    const refresh = () => {
      const next = readRecoverySafety(isContextCurrent);
      setSafety(previous => (
        previous.contextCurrent === next.contextCurrent && previous.operationsIdle === next.operationsIdle
          ? previous : next
      ));
    };
    const handleConnection = () => setOnline(navigator.onLine !== false);
    const intervalId = window.setInterval(refresh, 1000);
    window.addEventListener('online', handleConnection);
    window.addEventListener('offline', handleConnection);
    const unsubscribeWorker = subscribeAdminServiceWorker(setWorker);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('online', handleConnection);
      window.removeEventListener('offline', handleConnection);
      unsubscribeWorker();
    };
  }, [isContextCurrent]);

  const canRestart = safety.contextCurrent && safety.operationsIdle;
  const canOfferUpdate = check.status === 'available' || check.status === 'pending'
    || worker.waiting || worker.reloadDeferred;
  const canApplyUpdate = canRestart && online
    && (worker.waiting || worker.reloadDeferred || !navigator.serviceWorker?.controller);

  const retry = () => {
    if (!readRecoverySafety(isContextCurrent).contextCurrent
      || !readRecoverySafety(isContextCurrent).operationsIdle) return;
    window.location.reload();
  };

  const checkUpdate = async () => {
    if (checkBusy) return;
    setHasChecked(true);
    setCheckBusy(true);
    setUpdateNotice('');
    try {
      await requestAdminServiceWorkerUpdateCheck({ force: true });
    } catch {
      setUpdateNotice(UPDATE_MESSAGES.error);
    } finally {
      setCheckBusy(false);
    }
  };

  const applyUpdate = async () => {
    const current = readRecoverySafety(isContextCurrent);
    if (!current.contextCurrent || !current.operationsIdle || navigator.onLine === false || applyBusy) return;
    setApplyBusy(true);
    setUpdateNotice('');
    try {
      const state = getAdminServiceWorkerState();
      const applied = state.waiting || state.reloadDeferred
        ? await activateAdminServiceWorkerUpdate()
        : !navigator.serviceWorker?.controller
          ? await reloadAdminWebUpdate()
          : false;
      if (!applied) {
        setUpdateNotice('No se pudo completar la actualización de forma segura. Conservamos tu versión y tus datos; consulta soporte.');
      }
    } catch {
      setUpdateNotice('La actualización quedó pendiente porque no fue seguro aplicarla. Cierra otras ventanas o consulta soporte; no borres los datos.');
    } finally {
      setApplyBusy(false);
    }
  };

  const report = [
    buildAdminBootSupportReport({
      errorCode: 'ADMIN_RUNTIME_BOOT_TIMEOUT',
      stage: 'ready_runtime_loading'
    }),
    `Reintento seguro: ${canRestart ? 'Disponible' : 'Bloqueado'}`,
    `Contexto actual: ${safety.contextCurrent ? 'Sí' : 'No'}`,
    `Operaciones en memoria sin terminar: ${safety.operationsIdle ? 'No detectadas' : 'No se puede descartar'}`,
    `Comprobación de actualización: ${hasChecked ? check.status : 'No solicitada'}`
  ].join('\n');
  const supportUrl = buildSupportMailtoUrl({
    subject: 'Inicio bloqueado - Lanzo POS',
    body: report
  });

  const copyReport = async () => {
    setCopyError('');
    const successful = await copyTextToClipboard(report);
    setCopied(successful);
    if (!successful) setCopyError('No se pudo copiar el diagnóstico. Puedes abrir el correo de soporte.');
  };

  return (
    <main className="app-boot-recovery">
      <section className="app-boot-recovery__card" aria-labelledby="app-boot-recovery-title">
        <AlertTriangle size={36} aria-hidden="true" />
        <h1 id="app-boot-recovery-title">No pudimos iniciar Lanzo POS</h1>
        <p>La aplicación tardó demasiado en prepararse. Primero intenta recuperar el inicio; no es necesario borrar datos ni reinstalar Lanzo.</p>

        <div className="app-boot-recovery__primary">
          <button type="button" className="ui-button ui-button--primary" onClick={retry}
            disabled={!canRestart} aria-describedby={!canRestart ? 'app-boot-recovery-disabled' : undefined}>
            <RefreshCw size={18} aria-hidden="true" />
            Reintentar inicio
          </button>
          {!canRestart && (
            <p className="app-boot-recovery__note" id="app-boot-recovery-disabled" role="status">
              {safety.operationsIdle
                ? 'La sesión o el negocio cambió durante el inicio. Por seguridad, no podemos reiniciar desde esta pantalla.'
                : 'No podemos confirmar que las operaciones locales hayan terminado. El reinicio está protegido.'}
            </p>
          )}
        </div>

        <div className="app-boot-recovery__secondary" aria-label="Otras opciones de recuperación">
          <h2>¿Sigue sin iniciar?</h2>
          <p>Comprobar una versión nueva es independiente del inicio. Solo se aplicará si es seguro hacerlo.</p>
          <button type="button" className="ui-button ui-button--secondary"
            onClick={checkUpdate} disabled={checkBusy || check.status === 'checking'}>
            <RefreshCw size={17} aria-hidden="true" />
            {checkBusy || check.status === 'checking' ? 'Comprobando…' : 'Comprobar actualización'}
          </button>
          {hasChecked && (
            <p role="status" className="app-boot-recovery__update-status">
              {updateNotice || UPDATE_MESSAGES[check.status] || 'Comprobación no disponible.'}
            </p>
          )}
          {hasChecked && canOfferUpdate && (
            <>
              <button type="button" className="ui-button ui-button--secondary" onClick={applyUpdate}
                disabled={!canApplyUpdate || applyBusy}>
                {applyBusy ? 'Aplicando actualización…' : 'Actualizar ahora'}
              </button>
              {!canApplyUpdate && (
                <p className="app-boot-recovery__note" role="status">
                  {online
                    ? 'Puedes comprobar la versión, pero no aplicarla hasta que la sesión y las operaciones sean seguras.'
                    : 'Conéctate a Internet para aplicar la actualización.'}
                </p>
              )}
            </>
          )}
        </div>

        <div className="app-boot-recovery__footer">
          <details className="app-boot-recovery__support">
            <summary>Ver diagnóstico</summary>
            <div className="app-boot-recovery__details">
              <p><strong>Código:</strong> ADMIN_RUNTIME_BOOT_TIMEOUT</p>
              <p><strong>Etapa:</strong> Preparación de la aplicación</p>
              <p><strong>Versión:</strong> {APP_VERSION_LABEL}</p>
              <p><strong>Conexión:</strong> {online ? 'En línea' : 'Sin conexión'}</p>
              <p><strong>Reintento:</strong> {canRestart ? 'Disponible' : 'Bloqueado por seguridad'}</p>
              <p>No se ha confirmado la causa exacta del retraso.</p>
              <button type="button" className="ui-button ui-button--secondary" onClick={copyReport}>
                {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                {copied ? 'Diagnóstico copiado' : 'Copiar diagnóstico'}
              </button>
              {copyError && <p role="status">{copyError}</p>}
            </div>
          </details>
          <a className="app-boot-recovery__support-link" href={supportUrl}>
            <Mail size={17} aria-hidden="true" /> Contactar soporte
          </a>
        </div>
        <p className="app-boot-recovery__note">
          Tus datos locales no se han borrado. Si quedó una venta o cobro sin confirmar, consulta su resultado antes de repetirlo.
        </p>
      </section>
    </main>
  );
}
