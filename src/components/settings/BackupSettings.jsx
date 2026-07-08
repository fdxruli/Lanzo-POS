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
import './BackupSettings.css';

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

function LocalBackupSettings({ backupContext, isCloudLicense = false }) {
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
  const restoreDescription = isCloudLicense
    ? 'Usa esta opcion con cuidado: una copia local puede actualizar informacion local o cache de este dispositivo.'
    : 'Usa esta opcion con cuidado. Antes de continuar se creara una copia preventiva.';

  const run = async (action, successMessage) => {
    setError('');
    try {
      const result = await action();
      if (successMessage) toast.success(successMessage);
      return result;
    } catch (actionError) {
      const message = actionError.message === 'BACKUP_PIN_INVALID'
        ? 'PIN incorrecto.'
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

    setManualBackupPhase('encrypting');
    const result = await run(async () => {
      const backupResult = await backupManager.backup({
        reason: 'manual_settings',
        manual: true,
        includeBlob: shouldUploadToDrive
      });

      if (shouldUploadToDrive) {
        if (!(backupResult.blob instanceof Blob)) {
          throw new Error('El worker no devolvio el respaldo cifrado para Google Drive.');
        }
        setManualBackupPhase('uploading');
        await googleDriveService.uploadBackup(
          driveAccessToken,
          backupResult.blob,
          backupResult.fileName
        );
      }

      return backupResult;
    });

    if (!result) {
      setManualBackupPhase('idle');
      return;
    }

    setManualBackupPhase('completed');
    toast.success(
      shouldUploadToDrive
        ? 'Respaldo cifrado subido a Google Drive.'
        : 'Respaldo completado.'
    );
  };

  const handleFileSelect = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) setRestoreFile(file);
  };

  const executeRestore = async () => {
    if (!restoreFile || !restorePin) return;
    const confirmed = await showConfirmModal(
      'La restauracion aplicara el archivo seleccionado en este dispositivo. Antes se creara una copia preventiva. Continuar?',
      {
        title: 'Restaurar respaldo',
        confirmButtonText: 'Si, restaurar',
        cancelButtonText: 'Cancelar'
      }
    );
    if (!confirmed) return;

    const result = await run(() => backupManager.restore(restoreFile, restorePin));
    if (result) {
      toast.success('Restauracion completada. La aplicacion se recargara.');
      setRestoreFile(null);
      setRestorePin('');
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
            {status.busy ? <><Loader2 size={17} className="animate-spin" /> Configurando...</> : configureButtonLabel}
          </button>
        </div>
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
        <div><dt>Cron</dt><dd>{status.settings.cronBlocked ? 'Detenido por error' : 'Activo'}</dd></div>
      </dl>

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

      <div className="backup-settings-danger">
        <div className="backup-danger-heading">
          <span className="backup-danger-icon" aria-hidden="true"><RotateCcw size={17} /></span>
          <div>
            <h5>Restaurar respaldo</h5>
            <p>{restoreDescription}</p>
          </div>
        </div>

        <div className="backup-settings-inline">
          <button type="button" className="btn btn-secondary" onClick={() => restoreInputRef.current?.click()} disabled={status.busy || !status.unlocked}>
            <RotateCcw size={17} /> {restoreFile ? 'Cambiar archivo' : 'Seleccionar archivo'}
          </button>
          <input ref={restoreInputRef} type="file" accept=".lzbk,application/octet-stream" hidden onChange={handleFileSelect} aria-label="Archivo de respaldo a restaurar" />
          {restoreFile && <span className="backup-settings-filename">{restoreFile.name}</span>}
        </div>

        {restoreFile && (
          <div className="backup-settings-inline">
            <input type="password" inputMode="numeric" value={restorePin} onChange={(event) => setRestorePin(event.target.value.replace(/\D/g, ''))} placeholder="PIN con el que se creo este archivo" aria-label="PIN del archivo de respaldo" />
            <button type="button" className="btn btn-primary" onClick={executeRestore} disabled={status.busy || restorePin.length < 8}>
              <RotateCcw size={17} /> Restaurar
            </button>
          </div>
        )}

        {restoreFile && (
          <button type="button" className="backup-settings-cancel" onClick={() => { setRestoreFile(null); setRestorePin(''); }}>
            Cancelar restauracion
          </button>
        )}
      </div>

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
  const backupContext = useBackupManager();
  const { status } = backupContext;

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
          <LocalBackupSettings backupContext={backupContext} isCloudLicense={isCloudLicense} />
        </div>
      </section>
    </div>
  );
}
