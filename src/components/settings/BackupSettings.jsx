import { useRef, useState } from 'react';
import {
  DatabaseBackup,
  FolderKey,
  KeyRound,
  Loader2,
  LockKeyhole,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles
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
          <h5>Restaurar respaldo</h5>
          <p>Valida el archivo y revisa su contenido antes de aplicarlo. Puedes hacerlo en un equipo nuevo con la licencia activada y el PIN del archivo.</p>
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
            <input type="password" inputMode="numeric" value={restorePin} onChange={(event) => setRestorePin(event.target.value.replace(/\D/g, ''))} placeholder="PIN con el que se creó este archivo" aria-label="PIN del archivo de respaldo" />
            <button type="button" className="btn btn-secondary" onClick={validateRestore} disabled={status.busy || restorePin.length < 8}>
              Revisar archivo
            </button>
          </div>

          {restorePreview && (
            <div className="backup-restore-preview" role="status">
              <strong>Versión {restorePreview.formatVersion} · {restorePreview.header?.createdAt ? formatDate(restorePreview.header.createdAt) : 'fecha no disponible'}</strong>
              <p>La cobertura de este archivo es {restorePreview.coverage?.complete === true ? 'completa' : 'parcial'}.</p>
              {categoryCounts.length > 0 && (
                <ul>
                  {categoryCounts.map(([label, count]) => <li key={label}>{label}: {count}</li>)}
                </ul>
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
            <button type="button" className="backup-settings-cancel" onClick={() => clearRestore(null)}>
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
  uploading: 'Subiendo a la nube...',
  completed: 'Completado'
};

function formatDate(value) {
  if (!value) return 'Nunca';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Nunca' : date.toLocaleString();
}

function BackupHero({ status, isCloudLicense }) {
  const protectionLabel = isCloudLicense ? 'Cloud + local' : status.configured ? 'Local cifrado' : 'Pendiente';
  const sessionLabel = status.configured ? (status.unlocked ? 'Desbloqueada' : 'Bloqueada') : 'Sin configurar';

  return (
    <header className="backup-settings-hero">
      <div className="backup-hero-copy">
        <span className="backup-kicker">
          <Sparkles size={15} />
          Respaldos
        </span>
        <div>
          <h2>Proteccion de datos</h2>
          <p>Administra copias cifradas, restauracion y conexion opcional con Google Drive.</p>
        </div>
      </div>

      <div className="backup-hero-summary" aria-label="Resumen de respaldos">
        <div>
          <span>Proteccion</span>
          <strong>{protectionLabel}</strong>
        </div>
        <div>
          <span>Sesion</span>
          <strong>{sessionLabel}</strong>
        </div>
        <div>
          <span>Ultimo respaldo</span>
          <strong>{formatDate(status.settings?.lastBackupAt)}</strong>
        </div>
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
  isCloudLicense = false,
  isAdmin = false
}) {
  const { status, backupManager } = backupContext;
  const driveAccessToken = useAppStore((state) => state.driveAccessToken);
  const driveTokenExpiresAt = useAppStore((state) => state.driveTokenExpiresAt);
  const isDriveConnected = useAppStore((state) => state.isDriveConnected);
  const markDriveNeedsReauth = useAppStore((state) => state.markDriveNeedsReauth);
  const restoreInputRef = useRef(null);
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [newPinConfirm, setNewPinConfirm] = useState('');
  const [selectedDirectory, setSelectedDirectory] = useState(null);
  const [restorePin, setRestorePin] = useState('');
  const [restoreFile, setRestoreFile] = useState(null);
  const [restorePreview, setRestorePreview] = useState(null);
  const [error, setError] = useState('');
  const [manualBackupPhase, setManualBackupPhase] = useState('idle');

  const initialTitle = isCloudLicense ? 'Copia local cifrada opcional' : 'Respaldos Locales Cifrados';
  const configuredTitle = isCloudLicense ? 'Copia local cifrada adicional' : 'Respaldos Locales Cifrados';
  const initialDescription = isCloudLicense
    ? 'Tus datos principales se sincronizan en la nube. Configura un PIN solo si deseas copias locales cifradas.'
    : 'Configura un PIN de al menos 8 digitos y la carpeta donde se guardaran las copias.';
  const configuredDescription = isCloudLicense
    ? 'Esta copia complementa la sincronizacion en la nube para exportar o resguardar archivos locales.'
    : 'Archivos AES-GCM por fragmentos, con rotacion automatica de siete copias.';
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
    setRestoreFile(file);
    setRestorePreview(null);
    setRestorePin('');
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
    if (preview) setRestorePreview(preview);
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
    setManualBackupPhase('idle');
    const shouldUploadToDrive = isDriveConnected;
    const hasValidAccessToken = Boolean(
      driveAccessToken
      && driveTokenExpiresAt
      && driveTokenExpiresAt > Date.now()
    );

    if (shouldUploadToDrive && !hasValidAccessToken) {
      markDriveNeedsReauth();
      const message = 'La sesion de Google Drive expiro. Reconecta tu cuenta antes de respaldar.';
      setError(message);
      toast.error(message);
      return;
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

    if (shouldUploadToDrive) {
      setManualBackupPhase('uploading');
      const uploaded = await run(
        async (currentActorHandle) => {
          if (!(result.blob instanceof Blob)) {
            throw new Error('El worker no devolvio el respaldo cifrado para Google Drive.');
          }
          currentActorHandle.assertCurrent('settings_backup');
          await googleDriveService.uploadBackup(
            driveAccessToken,
            result.blob,
            result.fileName
          );
          return true;
        },
        null,
        actorHandle
      );

      if (!uploaded) {
        setManualBackupPhase('idle');
        return;
      }
    }

    setManualBackupPhase('completed');
    if (result.coverage?.complete === false) {
      toast('Respaldo guardado con cobertura parcial. Revisa las condiciones señaladas antes de continuar.', { icon: '⚠️' });
    } else {
      toast.success(shouldUploadToDrive ? 'Respaldo cifrado subido a Google Drive.' : 'Respaldo completado.');
    }
  };

  const executeRestore = async () => {
    if (!restoreFile || !restorePin || !restorePreview) return;
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
    if (!confirmed) return;

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
      <section className="backup-settings-card backup-settings-card--local">
        <CardHeading
          Icon={DatabaseBackup}
          eyebrow="Copia local"
          title={initialTitle}
          description={initialDescription}
        />

        <LegacyBackupConfigurationNotice status={status} />

        {!status.supported && (
          <div className="backup-settings-notice">
            Este navegador no admite escritura silenciosa en carpetas. Cada respaldo generara una descarga manual.
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
            <button type="button" className="btn btn-secondary" onClick={chooseDirectory}>
              <FolderKey size={17} /> {selectedDirectory ? selectedDirectory.name : 'Seleccionar carpeta'}
            </button>
          )}
        </div>

        {error && <p className="backup-settings-error">{error}</p>}

        <div className="backup-settings-actions">
          <button type="button" className="btn btn-primary" onClick={configure} disabled={status.busy || pin.length < 8 || pin !== pinConfirm}>
            {status.busy ? <><Loader2 size={17} className="animate-spin" /> Configurando...</> : status.legacyConfiguration?.available ? 'Configurar respaldo para este negocio' : configureButtonLabel}
          </button>
        </div>
        <RestoreBackupPanel
          isAdmin={isAdmin}
          status={status}
          restoreInputRef={restoreInputRef}
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
  }

  return (
    <section className="backup-settings-card backup-settings-card--local">
      <CardHeading
        Icon={DatabaseBackup}
        eyebrow="Copia local"
        title={configuredTitle}
        description={configuredDescription}
      />

      <LegacyBackupConfigurationNotice status={status} />

      {!status.supported && (
        <div className="backup-settings-notice">
          Tu navegador no permite volcados invisibles. El respaldo manual descargara un archivo <code>.lzbk</code>.
        </div>
      )}

      <dl className="backup-settings-status">
        <div><dt>Carpeta</dt><dd>{status.settings.directoryName || 'Descargas del navegador'}</dd></div>
        <div><dt>Permiso</dt><dd>{status.permission}</dd></div>
        <div><dt>Sesion</dt><dd>{status.unlocked ? 'Desbloqueada' : 'Bloqueada'}</dd></div>
        <div><dt>Ultimo respaldo</dt><dd>{formatDate(status.settings.lastBackupAt)}</dd></div>
        <div><dt>Archivo</dt><dd>{status.settings.lastBackupFile || 'Sin archivo'}</dd></div>
        <div><dt>Automático</dt><dd>{status.settings.cronBlocked ? 'Revisa el error' : !status.supported ? 'Manual en este navegador' : status.unlocked && status.permission === 'granted' ? 'Cada 4 h con la app abierta' : 'Al desbloquear y autorizar'}</dd></div>
      </dl>
      {status.settings.lastCoverage?.complete === false && (
        <div className="backup-settings-notice" role="status">
          El último archivo tiene cobertura parcial. Revisa las operaciones pendientes, las cajas abiertas y los estados temporales omitidos.
        </div>
      )}

      {status.busy && !['encrypting', 'uploading'].includes(manualBackupPhase) && (
        <div className="backup-settings-progress">
          <span>{status.phase || 'Procesando'}: {status.progress}%</span>
          <progress max="100" value={status.progress} />
        </div>
      )}

      {manualBackupPhase !== 'idle'
        && !(manualBackupPhase === 'completed' && status.busy)
        && (
        <div className="backup-settings-progress" role="status" aria-live="polite">
          <span>{MANUAL_BACKUP_LABELS[manualBackupPhase]}</span>
          {manualBackupPhase === 'uploading'
            ? <progress max="100" />
            : (
              <progress
                max="100"
                value={manualBackupPhase === 'completed' ? 100 : status.progress}
              />
            )}
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
          <button type="button" className="btn btn-primary" onClick={unlock} disabled={pin.length < 8}>
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
          <button type="button" className="btn btn-secondary" onClick={() => run(() => backupManager.requestPermission())}>
            Autorizar carpeta
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary"
          onClick={manualBackup}
          disabled={status.busy || !status.unlocked || ['encrypting', 'uploading'].includes(manualBackupPhase)}
        >
          <span aria-hidden="true">
            {['encrypting', 'uploading'].includes(manualBackupPhase)
              ? <Loader2 size={17} className="animate-spin" />
              : <RefreshCw size={17} />}
          </span>
          <span>{MANUAL_BACKUP_LABELS[manualBackupPhase] || manualBackupLabel}</span>
        </button>
      </div>

      <RestoreBackupPanel
        isAdmin={isAdmin}
        status={status}
        restoreInputRef={restoreInputRef}
        restoreFile={restoreFile}
        restorePin={restorePin}
        restorePreview={restorePreview}
        setRestorePin={setRestorePin}
        clearRestore={clearRestore}
        validateRestore={validateRestore}
        executeRestore={executeRestore}
      />

      {status.supported && (
        <div className="backup-settings-danger">
          <div className="backup-danger-heading">
            <span className="backup-danger-icon backup-danger-icon--neutral" aria-hidden="true"><LockKeyhole size={17} /></span>
            <div>
              <h5>Cambiar PIN y recifrar archivos</h5>
              <p>Actualiza la clave local y recifra los respaldos existentes.</p>
            </div>
          </div>
          <div className="backup-settings-grid backup-settings-grid--three">
            <label>PIN actual<input type="password" inputMode="numeric" value={currentPin} onChange={(event) => setCurrentPin(event.target.value.replace(/\D/g, ''))} /></label>
            <label>PIN nuevo<input type="password" inputMode="numeric" value={newPin} onChange={(event) => setNewPin(event.target.value.replace(/\D/g, ''))} /></label>
            <label>Confirmar<input type="password" inputMode="numeric" value={newPinConfirm} onChange={(event) => setNewPinConfirm(event.target.value.replace(/\D/g, ''))} /></label>
          </div>
          <button type="button" className="btn btn-secondary" onClick={changePin} disabled={status.busy || currentPin.length < 8 || newPin.length < 8 || newPin !== newPinConfirm}>
            Recifrar respaldos
          </button>
        </div>
      )}

      {(error || status.settings.lastError) && (
        <p className="backup-settings-error">{error || status.settings.lastError}</p>
      )}
    </section>
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

  return (
    <div className="backup-settings-shell">
      <BackupHero status={status} isCloudLicense={isCloudLicense} />

      <section className="backup-settings-layout">
        <div className="backup-cloud-column">
          <GoogleDriveSettings />
          <div className="backup-safety-note">
            <ShieldCheck size={18} />
            <span>Los respaldos locales se cifran antes de guardarse o restaurarse.</span>
          </div>
        </div>

        <div className="backup-local-column">
          <LocalBackupSettings
            backupContext={backupContext}
            captureSettingsAction={captureSettingsAction}
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
