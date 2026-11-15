import { useEffect, useRef, useState } from 'react';
import {
  DatabaseBackup,
  FolderKey,
  KeyRound,
  Loader2,
  LockKeyhole,
  RefreshCw,
  RotateCcw
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useBackupManager } from '../../hooks/useBackupManager';
import * as googleDriveService from '../../services/googleDriveService';
import { useAppStore } from '../../store/useAppStore';
import { showConfirmModal } from '../../services/utils';
import GoogleDriveSettings from './GoogleDriveSettings';
import NoPermission from '../common/NoPermission';
import DataPortabilitySettings from './DataPortabilitySettings';
import {
  useSettingsAccess,
  useSettingsActionGuard
} from '../../services/auth/useSettingsAccess';
import './BackupSettings.css';

const RESTORE_CATEGORY_LABELS = {
  catalog: 'Catálogo',
  inventory: 'Inventario y lotes',
  customers: 'Clientes e historial de crédito',
  sales: 'Ventas',
  layaways: 'Apartados',
  cash: 'Cajas y movimientos',
  deletedRecords: 'Registros eliminados',
  sequences: 'Secuencias'
};

const RESTORE_PARTIAL_REASON_LABELS = {
  pending_operations_require_reconciliation: 'Hay operaciones de dinero o sincronización que requieren conciliación.',
  open_cash_sessions_require_reconciliation: 'Hay cajas abiertas que requieren conciliación antes de usarse.',
  browser_state_inspection_unavailable: 'No se pudo revisar todo el estado operativo guardado en el navegador.',
  pending_browser_operations_excluded: 'Hay pedidos, carritos o ajustes sin terminar que no se incluyen.',
  legacy_v1_backup_contains_only_original_tables: 'El formato V1 solo contiene productos, ventas y clientes.'
};

const RESTORE_PENDING_OPERATION_LABELS = {
  sync_outbox: 'sincronización pendiente',
  sync_conflicts: 'conflictos de sincronización',
  financial_intents: 'intenciones financieras sin recibo confirmado',
  transaction_log: 'transacciones locales sin resolver'
};

const LegacyBackupConfigurationNotice = ({ status }) => {
  const legacy = status.legacyConfiguration;
  if (!legacy?.available) return null;
  return (
    <div className="backup-settings-notice" role="status">
      <strong>Se encontró una configuración de respaldo anterior.</strong>
      <p>
        Sigue guardada en este navegador, incluidos los archivos existentes, pero no se asignó al negocio activo porque no se puede comprobar su propietario.
        {!status.configured && ' Para este negocio, configura un PIN y una carpeta propios en el formulario siguiente.'}
        {status.configured && ' Este negocio conserva su configuración separada.'}
      </p>
      {legacy.directoryName && <p>Carpeta anterior registrada: {legacy.directoryName}.</p>}
    </div>
  );
};

function RestoreBackupPanel({
  isAdmin,
  status,
  restoreInputRef,
  restorePinInputRef,
  restoreFile,
  restorePin,
  restorePreview,
  setRestorePin,
  clearRestore,
  validateRestore,
  executeRestore
}) {
  if (!isAdmin) return null;
  const categoryCounts = restorePreview?.coverage?.categoryCounts
    ? Object.entries(restorePreview.coverage.categoryCounts)
      .map(([category, count]) => [RESTORE_CATEGORY_LABELS[category] || category, count])
    : Object.entries(restorePreview?.sourceTableCounts || {})
      .map(([table, count]) => [table, count]);
  const partialReasons = restorePreview?.coverage?.partialReasons || [];
  const pendingDestinationOperations = Object.entries(restorePreview?.destinationPendingOperationCounts || {})
    .filter(([, count]) => Number(count) > 0);

  return (
    <div className="backup-settings-danger">
      <div className="backup-danger-heading">
        <span className="backup-danger-icon" aria-hidden="true"><RotateCcw size={17} /></span>
        <div>
          <h5>Desde un archivo</h5>
          <p>Selecciona un archivo .lzbk de este negocio. Las copias descargadas de Drive se revisan aquí con el mismo PIN original.</p>
        </div>
      </div>

      <div className="backup-settings-inline">
        <button type="button" className="btn btn-secondary" onClick={() => restoreInputRef.current?.click()} disabled={status.busy}>
          <RotateCcw size={17} /> {restoreFile ? 'Cambiar archivo' : 'Seleccionar archivo'}
        </button>
        <input ref={restoreInputRef} type="file" accept=".lzbk,application/octet-stream" hidden onChange={(event) => {
          const file = event.target.files?.[0] || null;
          event.target.value = '';
          clearRestore(file);
        }} aria-label="Archivo de respaldo a restaurar" />
        {restoreFile && <span className="backup-settings-filename">{restoreFile.name}</span>}
      </div>

      {restoreFile && (
        <>
          <div className="backup-settings-inline">
            <input ref={restorePinInputRef} type="password" inputMode="numeric" disabled={status.busy} value={restorePin} onChange={(event) => setRestorePin(event.target.value.replace(/\D/g, ''))} placeholder="PIN con el que se creó este archivo" aria-label="PIN del archivo de respaldo" />
            <button type="button" className="btn btn-secondary" onClick={validateRestore} disabled={status.busy || restorePin.length < 8}>
              Revisar archivo
            </button>
          </div>

          {restorePreview && (
            <div className="backup-restore-preview" role="status">
              <strong>Archivo revisado · Versión {restorePreview.formatVersion} · {restorePreview.header?.createdAt ? formatDate(restorePreview.header.createdAt) : 'fecha no disponible'}</strong>
              <p>Revisión completada; todavía no se han restaurado datos.</p>
              <p>La cobertura de este archivo es {restorePreview.coverage?.complete === true ? 'completa' : 'parcial'}.</p>
              {categoryCounts.length > 0 && (
                <>
                <p>Datos incluidos que se aplicarán en este equipo:</p>
                <ul>
                  {categoryCounts.map(([label, count]) => <li key={label}>{label}: {count}</li>)}
                </ul>
                </>
              )}
              {restorePreview.formatVersion === 1 && (
                <p>Este archivo antiguo solo contiene productos, ventas y clientes. Las tablas que faltan se conservarán.</p>
              )}
              {restorePreview.coverage?.openCashSessions > 0 && (
                <p>Hay {restorePreview.coverage.openCashSessions} caja(s) que deberán conciliarse. No se reasignará la estación del equipo anterior.</p>
              )}
              {Object.values(restorePreview.coverage?.pendingOperationCounts || {}).some((count) => Number(count) > 0) && (
                <p>Se detectaron operaciones financieras o de sincronización sin resolver. Se omiten del archivo para evitar repetir cargos o movimientos; concílialas antes de sincronizar.</p>
              )}
              {pendingDestinationOperations.length > 0 && (
                <p className="backup-restore-preview__warning">
                  Restauración bloqueada: el negocio destino tiene {pendingDestinationOperations
                    .map(([name, count]) => `${count} ${RESTORE_PENDING_OPERATION_LABELS[name] || name}`)
                    .join(', ')}. Sincroniza las operaciones pendientes y resuelve los conflictos o recibos inciertos antes de volver a revisar el archivo. No se modificaron registros.
                </p>
              )}
              {partialReasons.length > 0 && (
                <ul>
                  {partialReasons.map((reason) => <li key={reason}>{RESTORE_PARTIAL_REASON_LABELS[reason] || 'El archivo requiere una revisión adicional.'}</li>)}
                </ul>
              )}
              {restorePreview.destinationHasBusinessData ? (
                <p className="backup-restore-preview__warning">
                  Este equipo ya tiene datos en las tablas que se van a restaurar. Se reemplazarán. Se requiere una copia preventiva cifrada y desbloqueada antes de continuar.
                </p>
              ) : (
                <p>Este equipo no tiene datos comerciales previos en las tablas del archivo.</p>
              )}
            </div>
          )}

          <div className="backup-settings-inline">
            <button
              type="button"
              className="btn btn-primary"
              onClick={executeRestore}
              disabled={status.busy || !restorePreview || pendingDestinationOperations.length > 0 || (restorePreview.destinationHasBusinessData && (!status.configured || !status.unlocked))}
            >
              <RotateCcw size={17} /> Restaurar datos
            </button>
            <button type="button" className="backup-settings-cancel" disabled={status.busy} onClick={() => clearRestore(null)}>
              Cancelar
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const MANUAL_BACKUP_LABELS = {
  encrypting: 'Cifrando...',
  preparing: 'Preparando la subida a Google Drive...',
  uploading: 'Subiendo a Google Drive...',
  resuming: 'Reanudando la subida a Google Drive...',
  verifying: 'Verificando el archivo en Google Drive...',
  verification_pending: 'Verificación de Google Drive pendiente',
  error: 'No se completó la subida a Google Drive',
  completed: 'Completado'
};

const MANUAL_BACKUP_ACTIVE_PHASES = ['encrypting', 'preparing', 'uploading', 'resuming', 'verifying'];

function getDriveVerificationNotice(uploadResult) {
  if (uploadResult?.transferStatus === 'pending') {
    return ' No se pudo determinar si Google Drive terminó la transferencia. Conserva la copia local y revisa Drive antes de volver a intentarlo.';
  }
  if (uploadResult?.transferStatus === 'not_started') {
    return ' No se pudo iniciar una sesión de subida utilizable en Google Drive. Conserva la copia local y revisa Drive antes de volver a intentarlo.';
  }
  if (uploadResult?.transferStatus === 'failed' && uploadResult?.verificationReason === 'session_expired') {
    return ' La sesión de subida expiró y no se pudo completar. Conserva la copia local y revisa Drive antes de volver a intentarlo.';
  }
  if (uploadResult?.verificationStatus === 'failed') {
    return ' Google Drive terminó la transferencia, pero el nombre, el negocio o el tamaño remoto no coincidieron. No se limpiaron copias anteriores; revisa Drive antes de volver a intentarlo.';
  }
  return ' Google Drive terminó la transferencia, pero la verificación remota sigue pendiente. Conserva la copia local y revisa Drive antes de volver a intentarlo.';
}

function formatDate(value) {
  if (!value) return 'Nunca';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Nunca' : date.toLocaleString();
}

function BackupHero({ status, isCloudLicense }) {
  const connected = useAppStore((state) => state.isDriveConnected);
  const token = useAppStore((state) => state.driveAccessToken);
  const expiresAt = useAppStore((state) => state.driveTokenExpiresAt);
  const needsReauth = useAppStore((state) => state.needsDriveReauth);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const remaining = Number(expiresAt) - Date.now();
    setNow(Date.now());
    if (remaining > 0) {
      const timer = setTimeout(() => setNow(Date.now()), Math.min(remaining, 2_147_483_647));
      return () => clearTimeout(timer);
    }
  }, [expiresAt]);
  const driveLabel = connected && token && Number(expiresAt) > now && !needsReauth
    ? 'Conectado' : connected || needsReauth ? 'Requiere reconexión' : 'Desconectado';
  return (
    <header className="backup-settings-hero">
      <div className="backup-hero-copy">
        <span className="backup-hero-icon" aria-hidden="true"><DatabaseBackup size={20} /></span>
        <div>
          <h2>Respaldos y recuperación</h2>
          <p>{isCloudLicense
            ? 'La sincronización Cloud y el respaldo cifrado son protecciones distintas. Restaurar aquí no reconstruye todos los datos Cloud.'
            : 'Crea copias cifradas y conserva el PIN para recuperar tu negocio.'}</p>
        </div>
      </div>
      <div className="backup-hero-summary" aria-label="Resumen de respaldos">
        <span><b>Respaldo local:</b> {!status.initialized ? 'Consultando…' : status.configured ? 'Configurado' : 'Sin configurar'}</span>
        <span><b>PIN de respaldo:</b> {!status.initialized ? 'Consultando…' : !status.configured ? 'Sin configurar' : status.unlocked ? 'Desbloqueado' : 'Bloqueado'}</span>
        <span><b>Google Drive:</b> {driveLabel}</span>
        <span><b>Último respaldo local:</b> {formatDate(status.settings?.lastBackupAt)}</span>
        <span><b>Última copia Drive confirmada:</b> Sin información confirmada</span>
      </div>
    </header>
  );
}

function CardHeading({ Icon, eyebrow, title, description }) {
  return (
    <div className="backup-settings-card__heading">
      <span className="backup-card-icon" aria-hidden="true">
        <Icon size={20} />
      </span>
      <div>
        {eyebrow && <span className="backup-card-eyebrow">{eyebrow}</span>}
        <h4>{title}</h4>
        <p>{description}</p>
      </div>
    </div>
  );
}

function LocalBackupSettings({
  backupContext,
  captureSettingsAction,
  restoreState,
  setRestoreState,
  driveBusy,
  onDriveBusyChange,
  onWriteBusyChange,
  restoreActionPending,
  setRestoreActionPending,
  isCloudLicense = false,
  isAdmin = false
}) {
  const { status: managerStatus, backupManager } = backupContext;
  const status = { ...managerStatus, busy: managerStatus.busy || restoreActionPending };
  const driveAccessToken = useAppStore((state) => state.driveAccessToken);
  const driveTokenExpiresAt = useAppStore((state) => state.driveTokenExpiresAt);
  const isDriveConnected = useAppStore((state) => state.isDriveConnected);
  const markDriveNeedsReauth = useAppStore((state) => state.markDriveNeedsReauth);
  const restoreInputRef = useRef(null);
  const restorePinInputRef = useRef(null);
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [newPinConfirm, setNewPinConfirm] = useState('');
  const [selectedDirectory, setSelectedDirectory] = useState(null);
  const { pin: restorePin, file: restoreFile, preview: restorePreview } = restoreState;
  const restoreStateRef = useRef(restoreState);
  restoreStateRef.current = restoreState;
  const restoreActionRef = useRef(false);
  const setRestorePin = (value) => setRestoreState((current) => ({ ...current, pin: value, preview: null }));
  const restoreStatus = { ...status, busy: status.busy || driveBusy || restoreActionPending };
  const [error, setError] = useState('');
  useEffect(() => {
    setError('');
    if (restoreFile) restorePinInputRef.current?.focus();
  }, [restoreFile]);
  const manualActionRef = useRef(false);
  const [backupResult, setBackupResult] = useState(null);
  const [manualBackupPhase, setManualBackupPhase] = useState('idle');
  const [manualBackupProgress, setManualBackupProgress] = useState(null);
  const manualBackupPercent = manualBackupProgress?.percent
    ?? (manualBackupPhase === 'completed'
      ? 100
      : manualBackupPhase === 'encrypting'
        ? status.progress
        : null);

  const initialTitle = isCloudLicense ? 'Copia local cifrada opcional' : 'Respaldos Locales Cifrados';
  const configuredTitle = isCloudLicense ? 'Copia local cifrada adicional' : 'Respaldos Locales Cifrados';
  const initialDescription = isCloudLicense
    ? 'Tus datos principales se sincronizan en la nube. Configura un PIN solo si deseas copias locales cifradas.'
    : 'Elige un PIN de al menos 8 dígitos y consérvalo en un lugar seguro. Sin él no podrás recuperar las copias.';
  const configuredDescription = isCloudLicense
    ? 'Esta copia complementa la sincronizacion en la nube para exportar o resguardar archivos locales.'
    : 'Guarda una copia cifrada. Necesitarás su PIN para recuperarla.';
  const configureSuccessMessage = isCloudLicense
    ? 'Copia local cifrada configurada.'
    : 'Respaldos cifrados configurados.';
  const configureButtonLabel = isCloudLicense ? 'Configurar copia opcional' : 'Configurar respaldos';
  const manualBackupLabel = isCloudLicense ? 'Generar copia local' : 'Respaldar ahora';
  const run = async (action, successMessage, existingHandle = null) => {
    setError('');
    let actorHandle = existingHandle;
    try {
      actorHandle ||= captureSettingsAction('settings_backup');
      actorHandle.assertCurrent('settings_backup');
      const result = await action(actorHandle);
      actorHandle.assertCurrent('settings_backup');
      if (successMessage) toast.success(successMessage);
      return result;
    } catch (actionError) {
      if (!actorHandle) return null;
      try {
        actorHandle.assertCurrent('settings_backup');
      } catch {
        return null;
      }
      const message = actionError.message === 'BACKUP_PIN_INVALID'
        ? 'PIN incorrecto.'
        : actionError.message === 'BACKUP_AUTHENTICATION_FAILED'
          ? 'PIN incorrecto o archivo dañado. Revisa el PIN original del respaldo.'
        : actionError.message === 'BACKUP_TENANT_MISMATCH'
          ? 'No se puede verificar que el respaldo pertenezca a la licencia de este negocio.'
        : actionError.message === 'BACKUP_PRE_RESTORE_FAILED'
          ? 'Falló la copia preventiva. No se reemplazaron los datos del negocio.'
        : actionError.message === 'BACKUP_DESTINATION_PROTECTION_REQUIRED'
          ? 'Configura y desbloquea la copia preventiva antes de reemplazar los datos de este equipo.'
        : actionError.message === 'BACKUP_DESTINATION_CHANGED_REVIEW_AGAIN'
          ? 'Los datos del destino cambiaron. Vuelve a revisar el respaldo antes de restaurar.'
        : /^BACKUP_(INVALID|UNSUPPORTED|INTEGRITY|CHUNK|COVERAGE|REQUIRED_TABLES|TABLE_METADATA|DATABASE_MISMATCH)/.test(actionError.message)
          ? 'El respaldo está dañado o no es compatible. Selecciona otra copia y vuelve a revisarla.'
        : actionError.message === 'BACKUP_RESTORE_REVIEW_REQUIRED' || actionError.message === 'BACKUP_TENANT_CONTEXT_STALE'
          ? 'La sesión, la licencia o el archivo cambió. Vuelve a seleccionar y revisar el respaldo.'
        : actionError.message === 'BACKUP_RESTORE_PENDING_OPERATIONS'
          ? 'No se restauró: el negocio destino tiene operaciones de sincronización o financieras pendientes. Sincronízalas y resuelve recibos inciertos antes de volver a revisar el archivo.'
        : actionError.message;
      setError(message);
      toast.error(message);
      return null;
    }
  };

  const chooseDirectory = async () => {
    const handle = await run(() => backupManager.chooseDirectory());
    if (handle) setSelectedDirectory(handle);
  };

  const clearRestore = (file = null) => {
    setRestoreState({ file, pin: '', preview: null });
    setError('');
  };

  const validateRestore = async () => {
    if (!restoreFile || !restorePin) return;
    let actorHandle;
    try {
      actorHandle = captureSettingsAction('settings_backup', { adminOnly: true });
    } catch {
      return;
    }
    const preview = await run(
      () => backupManager.inspectRestore(restoreFile, restorePin),
      null,
      actorHandle
    );
    if (preview) setRestoreState((current) => current.file === restoreFile && current.pin === restorePin
      ? { ...current, preview } : current);
  };

  const configure = async () => {
    if (pin !== pinConfirm) {
      setError('Los PIN no coinciden.');
      return;
    }
    if (status.supported && !selectedDirectory) {
      setError('Selecciona una carpeta de respaldo.');
      return;
    }
    const result = await run(
      () => backupManager.configure(pin, selectedDirectory),
      configureSuccessMessage
    );
    if (result) {
      setPin('');
      setPinConfirm('');
    }
  };

  const unlock = async () => {
    const result = await run(() => backupManager.unlock(pin), 'Respaldos desbloqueados para esta sesion.');
    if (result) setPin('');
  };

  const manualBackup = async () => {
    if (manualActionRef.current || status.busy) return;
    manualActionRef.current = true;
    onWriteBusyChange(true);
    setBackupResult(null);
    try {
      setManualBackupPhase('idle');
      setManualBackupProgress(null);
      const hasValidAccessToken = Boolean(
        driveAccessToken
        && driveTokenExpiresAt
        && driveTokenExpiresAt > Date.now()
      );
      const driveSessionExpired = isDriveConnected && !hasValidAccessToken;
      const shouldUploadToDrive = isDriveConnected && hasValidAccessToken;

      if (driveSessionExpired) {
        markDriveNeedsReauth();
      }

      let actorHandle;
      try {
        actorHandle = captureSettingsAction('settings_backup');
      } catch {
        return;
      }

      setManualBackupPhase('encrypting');
      const result = await run(
        () => backupManager.backup({
          reason: 'manual_settings',
          manual: true,
          includeBlob: shouldUploadToDrive
        }),
        null,
        actorHandle
      );

      if (!result) {
        setManualBackupPhase('idle');
        return;
      }

      setBackupResult({ local: true, remote: 'Sin subida confirmada', partial: result.coverage?.complete === false });
      let uploadResult = null;
      if (shouldUploadToDrive) {
        setManualBackupPhase('preparing');
        try {
          if (!(result.blob instanceof Blob)) {
            throw new Error('El worker no devolvio el respaldo cifrado para Google Drive.');
          }
          actorHandle.assertCurrent('settings_backup');
          uploadResult = await googleDriveService.uploadBackup(
            driveAccessToken,
            result.blob,
            result.fileName,
            {
              onProgress: (progress) => {
                setManualBackupProgress(progress);
                setManualBackupPhase(progress.phase);
              }
            }
          );
          if (!['confirmed', 'verification_pending'].includes(uploadResult?.uploadStatus)) {
            throw new Error('No se confirmó la subida a Google Drive.');
          }
        } catch (driveError) {
          const message = driveError.code === 'AUTH_REQUIRED' || driveError.status === 401
            ? 'El respaldo local quedó generado, pero la sesión de Google Drive expiró y no se confirmó la subida.'
            : driveError.code === 'BACKUP_PERMISSION_REQUIRED'
              ? 'El respaldo local quedó generado, pero el usuario actual no tiene permiso para subir copias a Google Drive.'
              : 'El respaldo local quedó generado, pero no se confirmó la subida a Google Drive.';
          setManualBackupPhase('error');
          setError(message);
          toast.error(message);
          return;
        }
      }

      setBackupResult({ local: true, partial: result.coverage?.complete === false,
        remote: uploadResult?.uploadStatus === 'confirmed' ? 'Subida a Drive confirmada'
          : uploadResult?.uploadStatus === 'verification_pending' ? 'Verificación pendiente'
          : driveSessionExpired ? 'Requiere reconexión; no se subió una copia' : 'No se solicitó subida a Drive',
        cleanupPending: uploadResult?.uploadStatus === 'confirmed' && uploadResult?.cleanupStatus === 'pending' });
      const driveVerificationPending = shouldUploadToDrive
        && uploadResult?.uploadStatus === 'verification_pending';
      setManualBackupPhase(driveVerificationPending ? 'verification_pending' : 'completed');
      const driveVerificationNotice = driveVerificationPending
        ? getDriveVerificationNotice(uploadResult)
        : '';
      if (result.coverage?.complete === false) {
        const destination = shouldUploadToDrive && !driveVerificationPending
          ? 'local y subido a Google Drive'
          : 'localmente';
        const cleanupNotice = shouldUploadToDrive
          && uploadResult?.uploadStatus === 'confirmed'
          && uploadResult?.cleanupStatus === 'pending'
          ? uploadResult.cleanupReason === 'reauth_required'
            ? ' La sesión de Google expiró después de la subida; las copias anteriores se conservaron. Reconecta para reintentar la limpieza.'
            : ' La limpieza de copias anteriores quedó pendiente; se conservaron.'
          : '';
        const reauthNotice = driveSessionExpired ? ' Google Drive requiere reconexión; no se subió una copia.' : '';
        toast(`Respaldo guardado ${destination} con cobertura parcial. Revisa las condiciones señaladas antes de continuar.${driveVerificationNotice}${cleanupNotice}${reauthNotice}`, { icon: '⚠️' });
      } else if (driveVerificationPending) {
        toast(`El respaldo local se guardó.${driveVerificationNotice}`, { icon: '⚠️' });
      } else if (shouldUploadToDrive && uploadResult?.cleanupStatus === 'pending') {
        const message = uploadResult.cleanupReason === 'reauth_required'
          ? 'Respaldo cifrado subido a Google Drive. La sesión expiró antes de limpiar copias anteriores; se conservaron. Reconecta para reintentar la limpieza.'
          : 'Respaldo cifrado subido a Google Drive. La limpieza de copias anteriores quedó pendiente; se conservaron.';
        toast(message, { icon: '⚠️' });
      } else if (driveSessionExpired) {
        toast('Respaldo local completado. Google Drive requiere reconexión; no se subió una copia.', { icon: '⚠️' });
      } else {
        toast.success(shouldUploadToDrive ? 'Respaldo cifrado subido a Google Drive.' : 'Respaldo completado.');
      }
    } finally {
      manualActionRef.current = false;
      onWriteBusyChange(false);
    }
  };

  const executeRestore = async () => {
    if (!restoreFile || !restorePin || !restorePreview || restoreActionRef.current || restoreStatus.busy) return;
    restoreActionRef.current = true;
    setRestoreActionPending(true);
    try {
      let actorHandle;
      try {
        actorHandle = captureSettingsAction('settings_backup', { adminOnly: true });
      } catch {
        return;
      }
      const confirmed = await showConfirmModal(
        restorePreview.destinationHasBusinessData
          ? 'Los datos actuales de las tablas del respaldo serán reemplazados. Se guardará una copia preventiva cifrada antes de continuar. ¿Restaurar?'
          : 'Se agregarán los datos del respaldo a este equipo, que no tiene datos comerciales en esas tablas. ¿Continuar?',
        {
          title: 'Restaurar respaldo',
          confirmButtonText: 'Si, restaurar',
          cancelButtonText: 'Cancelar'
        }
      );
      if (!confirmed || restoreStateRef.current !== restoreState) return;

      try {
        actorHandle.assertCurrent('settings_backup');
      } catch {
        return;
      }

      const result = await run(
        () => backupManager.restore(restoreFile, restorePin, restorePreview),
        null,
        actorHandle
      );
      if (result) {
        toast.success('Restauracion completada. La aplicacion se recargara.');
        clearRestore(null);
        setTimeout(() => window.location.reload(), 800);
      }
    } finally {
      restoreActionRef.current = false;
      setRestoreActionPending(false);
    }
  };

  const changePin = async () => {
    if (newPin !== newPinConfirm) {
      setError('La confirmacion del nuevo PIN no coincide.');
      return;
    }
    const result = await run(
      () => backupManager.changePin(currentPin, newPin),
      'Los respaldos existentes fueron recifrados.'
    );
    if (result) {
      setCurrentPin('');
      setNewPin('');
      setNewPinConfirm('');
    }
  };

  const connection = <GoogleDriveSettings mode="connection" disabled={status.busy || restoreActionPending || MANUAL_BACKUP_ACTIVE_PHASES.includes(manualBackupPhase)} />;
  const recovery = isAdmin && (
    <section className="backup-settings-card backup-recovery" aria-label="Recuperar información">
      <CardHeading Icon={RotateCcw} title="Recuperar información" description="Elige una copia, introduce su PIN y revisa los datos antes de restaurar." />
      <GoogleDriveSettings mode="recovery" disabled={status.busy || MANUAL_BACKUP_ACTIVE_PHASES.includes(manualBackupPhase)}
        onBusyChange={onDriveBusyChange} onBackupDownloaded={(file) => clearRestore(file)} />
      <RestoreBackupPanel
          isAdmin={isAdmin}
          status={restoreStatus}
          restoreInputRef={restoreInputRef}
          restorePinInputRef={restorePinInputRef}
          restoreFile={restoreFile}
          restorePin={restorePin}
          restorePreview={restorePreview}
          setRestorePin={setRestorePin}
          clearRestore={clearRestore}
          validateRestore={validateRestore}
          executeRestore={executeRestore}
        />
    </section>
  );

  if (!status.initialized) {
    return (
      <section className="backup-settings-card backup-settings-card--loading">
        <Loader2 className="animate-spin" />
        <span>Cargando configuracion...</span>
      </section>
    );
  }

  if (!status.configured) {
    return (
      <>
      <section className="backup-settings-card backup-settings-card--local" aria-label="Crear y proteger copias">
        <CardHeading
          Icon={DatabaseBackup}
          eyebrow="Crear y proteger copias"
          title={initialTitle}
          description={initialDescription}
        />

        <LegacyBackupConfigurationNotice status={status} />

        {!status.supported && (
          <div className="backup-settings-notice">
            En este navegador, cada respaldo se descarga como un archivo .lzbk. Guárdalo en un lugar seguro.
          </div>
        )}

        <div className="backup-setup-panel">
          <div className="backup-settings-grid">
            <label>
              PIN
              <input type="password" inputMode="numeric" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))} />
            </label>
            <label>
              Confirmar PIN
              <input type="password" inputMode="numeric" value={pinConfirm} onChange={(event) => setPinConfirm(event.target.value.replace(/\D/g, ''))} />
            </label>
          </div>

          {status.supported && (
            <button type="button" className="btn btn-secondary" onClick={chooseDirectory} disabled={status.busy}>
              <FolderKey size={17} /> {selectedDirectory ? selectedDirectory.name : 'Seleccionar carpeta'}
            </button>
          )}
        </div>

        {error && <p className="backup-settings-error" role="alert">{error}</p>}

        <div className="backup-settings-actions">
          <button type="button" className="btn btn-primary" onClick={configure} disabled={status.busy || pin.length < 8 || pin !== pinConfirm}>
            {status.busy ? <><Loader2 size={17} className="animate-spin" /> Configurando...</> : status.legacyConfiguration?.available ? 'Configurar respaldo para este negocio' : configureButtonLabel}
          </button>
        </div>

        {connection}
      </section>
      {recovery}
      </>
    );
  }

  return (
    <>
    <section className="backup-settings-card backup-settings-card--local" aria-label="Crear y proteger copias">
      <CardHeading
        Icon={DatabaseBackup}
        eyebrow="Crear y proteger copias"
        title={configuredTitle}
        description={configuredDescription}
      />

      <LegacyBackupConfigurationNotice status={status} />

      {!status.supported && (
        <div className="backup-settings-notice">
          Cada respaldo se descargará como un archivo cifrado <code>.lzbk</code>.
        </div>
      )}

      {status.settings.lastCoverage?.complete === false && (
        <div className="backup-settings-notice" role="status">
          El último archivo tiene cobertura parcial. Revisa las operaciones pendientes, las cajas abiertas y los estados temporales omitidos.
        </div>
      )}

      {status.busy && !MANUAL_BACKUP_ACTIVE_PHASES.includes(manualBackupPhase) && (
        <div className="backup-settings-progress">
          <span>{status.phase || 'Procesando'}: {status.progress}%</span>
          <progress aria-label="Progreso de la operación" max="100" value={status.progress} />
        </div>
      )}

      {backupResult && <div className="backup-settings-notice" role="status">
        <strong>Respaldo local generado.</strong>
        <p>{backupResult.remote}.</p>
        {backupResult.remote === 'Verificación pendiente' && <p>Conserva la copia local y consulta Drive antes de volver a intentarlo.</p>}
        {backupResult.cleanupPending && <p>Limpieza pendiente: la copia nueva está confirmada; las copias anteriores se conservaron.</p>}
        {backupResult.partial && <p>Cobertura parcial: revisa las operaciones pendientes, cajas abiertas y datos omitidos.</p>}
      </div>}

      {manualBackupPhase !== 'idle'
        && !(manualBackupPhase === 'completed' && status.busy)
        && (
        <div className="backup-settings-progress" role="status" aria-live="polite">
          <span>
            {MANUAL_BACKUP_LABELS[manualBackupPhase] || manualBackupLabel}
            {manualBackupPercent !== null && ` ${manualBackupPercent}%`}
          </span>
          <progress
            aria-label="Progreso del respaldo cifrado"
            max="100"
            {...(manualBackupPercent === null ? {} : { value: manualBackupPercent })}
          />
        </div>
        )}

      {!status.unlocked && (
        <div className="backup-settings-inline backup-unlock-panel">
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
            placeholder="PIN de respaldo"
            aria-label="PIN de respaldo para desbloquear"
          />
          <button type="button" className="btn btn-primary" onClick={unlock} disabled={status.busy || restoreActionPending || pin.length < 8}>
            <KeyRound size={17} /> Desbloquear
          </button>
        </div>
      )}

      <div className="backup-settings-actions backup-primary-actions">
        {status.supported && (
          <button type="button" className="btn btn-secondary" onClick={chooseDirectory} disabled={status.busy}>
            <FolderKey size={17} /> Cambiar carpeta
          </button>
        )}
        {status.supported && status.permission !== 'granted' && (
          <button type="button" className="btn btn-secondary" onClick={() => run(() => backupManager.requestPermission())} disabled={status.busy}>
            Autorizar carpeta
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary"
          onClick={manualBackup}
          disabled={status.busy || !status.unlocked || MANUAL_BACKUP_ACTIVE_PHASES.includes(manualBackupPhase)}
        >
          <span aria-hidden="true">
            {MANUAL_BACKUP_ACTIVE_PHASES.includes(manualBackupPhase)
              ? <Loader2 size={17} className="animate-spin" />
              : <RefreshCw size={17} />}
          </span>
          <span>{MANUAL_BACKUP_ACTIVE_PHASES.includes(manualBackupPhase) ? MANUAL_BACKUP_LABELS[manualBackupPhase] : manualBackupLabel}</span>
        </button>
      </div>



      <dl className="backup-settings-status backup-settings-status--destination">
        <div><dt>Automático</dt><dd>{status.settings.cronBlocked ? 'Revisa el error' : !status.supported ? 'Manual en este navegador' : status.unlocked && status.permission === 'granted' ? 'Cada 4 h con la app abierta' : 'Al desbloquear y autorizar'}</dd></div>
        <div><dt>Destino</dt><dd>{status.settings.directoryName || 'Descargas del navegador'}</dd></div>
      </dl>
      <details className="backup-advanced-details">
        <summary>Detalles técnicos de la copia</summary>
        <dl className="backup-settings-status backup-settings-status--technical">
          <div><dt>Permiso</dt><dd>{status.permission}</dd></div>
          <div><dt>Sesión</dt><dd>{status.unlocked ? 'Desbloqueada' : 'Bloqueada'}</dd></div>
          <div><dt>Archivo</dt><dd>{status.settings.lastBackupFile || 'Sin archivo'}</dd></div>
        </dl>
      </details>
      {status.supported && (
        <details className="backup-advanced-details">
          <summary><LockKeyhole size={16} aria-hidden="true" /> Cambiar PIN y recifrar archivos</summary>
          <div className="backup-settings-danger">
            <p>Actualiza la clave local y recifra los respaldos existentes.</p>
            <div className="backup-settings-grid backup-settings-grid--three">
              <label>PIN actual<input type="password" inputMode="numeric" value={currentPin} onChange={(event) => setCurrentPin(event.target.value.replace(/\D/g, ''))} /></label>
              <label>PIN nuevo<input type="password" inputMode="numeric" value={newPin} onChange={(event) => setNewPin(event.target.value.replace(/\D/g, ''))} /></label>
              <label>Confirmar<input type="password" inputMode="numeric" value={newPinConfirm} onChange={(event) => setNewPinConfirm(event.target.value.replace(/\D/g, ''))} /></label>
            </div>
            <button type="button" className="btn btn-secondary" onClick={changePin} disabled={status.busy || currentPin.length < 8 || newPin.length < 8 || newPin !== newPinConfirm}>
              Recifrar respaldos
            </button>
          </div>
        </details>
      )}

      {(error || status.settings.lastError) && (
        <p className="backup-settings-error" role="alert">{error || status.settings.lastError}</p>
      )}
      {connection}
    </section>
    {recovery}
    </>
  );
}

export default function BackupSettings({ isCloudLicense = false }) {
  const settingsAccess = useSettingsAccess();
  if (!settingsAccess.canAccessSection('backup')) return <NoPermission />;
  return <BackupSettingsContent isCloudLicense={isCloudLicense} settingsAccess={settingsAccess} />;
}

function BackupSettingsContent({ isCloudLicense = false, settingsAccess }) {
  const backupContext = useBackupManager();
  const { status } = backupContext;
  const captureSettingsAction = useSettingsActionGuard();
  const [restoreState, setRestoreState] = useState({ file: null, pin: '', preview: null });
  const [writeBusy, setWriteBusy] = useState(false);
  const [driveBusy, setDriveBusy] = useState(false);
  const [restoreActionPending, setRestoreActionPending] = useState(false);
  useEffect(() => {
    setRestoreState({ file: null, pin: '', preview: null });
  }, [settingsAccess.actorKey, settingsAccess.generation]);

  return (
    <div className="backup-settings-shell">
      <BackupHero status={status} isCloudLicense={isCloudLicense} />

      <section className="backup-settings-layout" aria-label="Protección y recuperación">
        <div className="backup-local-column">
          <LocalBackupSettings
            backupContext={{ ...backupContext, status: { ...status, busy: status.busy || writeBusy } }}
            onDriveBusyChange={setDriveBusy}
            onWriteBusyChange={setWriteBusy}
            captureSettingsAction={captureSettingsAction}
            restoreState={restoreState}
            setRestoreState={setRestoreState}
            driveBusy={driveBusy}
            restoreActionPending={restoreActionPending}
            setRestoreActionPending={setRestoreActionPending}
            isCloudLicense={isCloudLicense}
            isAdmin={settingsAccess.isAdmin}
          />
        </div>

      </section>
      <DataPortabilitySettings
        isAdmin={settingsAccess.isAdmin}
        captureSettingsAction={captureSettingsAction}
      />
    </div>
  );
}
