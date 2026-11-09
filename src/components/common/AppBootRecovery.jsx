import { useEffect, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, Check, Copy, Mail, RefreshCw } from 'lucide-react';
import { APP_VERSION_LABEL } from '../../config/appVersion';
import { getBootRetrySafety } from '../../services/diagnostics/bootRecoverySafety';
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

const BLOCK_REASON = Object.freeze({
  bootstrap_active: 'El inicio anterior sigue trabajando. No ejecutaremos otro intento mientras continúe.',
  operation_active: 'Hay una operación en curso. Debe terminar antes de volver a iniciar.',
  checkout_active: 'Hay un cobro activo sin resolver. No lo interrumpiremos.',
  database_active: 'El almacenamiento local está ocupado. No es seguro reintentar todavía.',
  backup_active: 'Espera a que termine el respaldo o la restauración.',
  write_active: 'Lanzo sigue guardando información local.',
  draft_active: 'Hay una operación protegida pendiente.',
  unverified: 'No pudimos comprobar el estado operativo. Contacta a soporte.'
});
const PHASE_LABEL = Object.freeze({
  starting: 'Inicio',
  reading_license: 'Lectura de licencia guardada',
  tenant_authority: 'Verificación del negocio',
  opening_database: 'Apertura de datos locales',
  reading_session: 'Lectura de sesión',
  staff_verification: 'Verificación de Staff',
  admin_verification: 'Verificación de Admin',
  actor_restoration: 'Restauración de sesión y cobros protegidos',
  loading_profile: 'Preparación del perfil del negocio',
  device_discovery: 'Verificación del dispositivo',
  reusing_session: 'Revalidación de sesión',
  not_started: 'No determinada',
  unknown: 'No determinada'
});

export default function AppBootRecovery({ initializeApp }) {
  const [safety, setSafety] = useState(getBootRetrySafety);
  const [retryBusy, setRetryBusy] = useState(false);
  const [retryNotice, setRetryNotice] = useState('');
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
      setSafety(getBootRetrySafety());
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
  }, []);

  const canRestart = safety.canRetry && !retryBusy && typeof initializeApp === 'function';
  const canOfferUpdate = check.status === 'available' || check.status === 'pending'
    || worker.waiting || worker.reloadDeferred;
  const canApplyUpdate = safety.canUpdate && !retryBusy && online
    && (worker.waiting || worker.reloadDeferred || !navigator.serviceWorker?.controller);

  const retry = async () => {
    if (retryBusy || typeof initializeApp !== 'function') return;
    const current = getBootRetrySafety();
    if (!current.canRetry) {
      setSafety(current);
      return;
    }
    setRetryBusy(true);
    setRetryNotice('');
    try {
      // Reuse the existing session/tenant validator; no forced reload,
      // checkout release, database reset or replay of a sale.
      const result = await initializeApp();
      if (result?.status === 'loading' || result?.status === 'failed') {
        setRetryNotice('No se pudo recuperar el inicio. Copia el diagnóstico para soporte.');
      } else if (result?.code === 'BOOTSTRAP_CONTEXT_STALE') {
        setRetryNotice('El contexto de acceso cambió durante el reintento. Se mantuvo bloqueado.');
      }
    } catch {
      setRetryNotice('Falló el reintento. Tus datos permanecen intactos; envía el diagnóstico a soporte.');
    } finally {
      setSafety(getBootRetrySafety());
      setRetryBusy(false);
    }
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
    const current = getBootRetrySafety();
    if (!current.canUpdate || navigator.onLine === false || applyBusy) return;
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
    `Reintento interno: ${safety.canRetry ? 'Disponible' : 'Bloqueado'}`,
    `Motivo del bloqueo: ${safety.reason || 'ninguno'}`,
    `Fase de inicio: ${safety.phase}`,
    `Operaciones activas: ${safety.pendingCount ?? 'no verificable'}`,
    `Cobros activos: ${safety.liveCheckouts ?? 'no verificable'}`,
    `Cobros protegidos persistidos: ${safety.savedCheckouts ?? 'no verificable'}`,
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
            {retryBusy ? 'Reintentando inicio…' : 'Reintentar inicio'}
          </button>
          {!canRestart && (
            <p className="app-boot-recovery__note" id="app-boot-recovery-disabled" role="status">
              {BLOCK_REASON[safety.reason] || 'Reintento no disponible.'}
            </p>
          )}
          {retryNotice && <p role="status" className="app-boot-recovery__note">{retryNotice}</p>}
          {safety.savedCheckouts > 0 && <p role="status" className="app-boot-recovery__note">Hay {safety.savedCheckouts} cobro(s) guardado(s) y protegido(s). El reintento no los desbloqueará ni repetirá.</p>}
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
              <p><strong>Etapa:</strong> {PHASE_LABEL[safety.phase] || 'No determinada'}</p>
              <p><strong>Motivo:</strong> {safety.reason || 'Ninguno'}</p>
              <p><strong>Operaciones activas:</strong> {safety.pendingCount ?? 'No verificable'}</p>
              <p><strong>Cobros protegidos guardados:</strong> {safety.savedCheckouts ?? 'No verificable'}</p>
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
