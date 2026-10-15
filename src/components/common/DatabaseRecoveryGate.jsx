import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, Check, Copy, Database, Mail, RefreshCw, RotateCw } from 'lucide-react';
import {
  DATABASE_RECOVERY_STATUS,
  getDatabaseRecoveryState,
  subscribeDatabaseRecoveryState
} from '../../services/db/databaseRecoveryState';
import {
  getActiveNativeOpenOperations,
  subscribeNativeOpenOperations
} from '../../services/db/indexedDbPreflight';
import {
  isLocalDatabasePreparationActive,
  retryLocalDatabaseRecovery
} from '../../services/db/databaseRuntime';
import {
  buildDatabaseRecoverySupportReport,
  buildSupportMailtoUrl,
  copyTextToClipboard
} from '../../services/support/supportContact';
import { getSafeIncidentCode, INCIDENT_CATEGORY } from '../../services/diagnostics/incidentDiagnostics';
import { captureIncident } from '../../services/diagnostics/incidentCapture';
import IncidentReportEntry from './IncidentReportEntry';

const useDatabaseRecoveryState = () => useSyncExternalStore(
  subscribeDatabaseRecoveryState,
  getDatabaseRecoveryState,
  getDatabaseRecoveryState
);

export const useNativeDatabaseOperationState = () => useSyncExternalStore(
  subscribeNativeOpenOperations,
  getActiveNativeOpenOperations,
  getActiveNativeOpenOperations
);

const BLOCKING_STATUSES = new Set([
  DATABASE_RECOVERY_STATUS.IDLE,
  DATABASE_RECOVERY_STATUS.CHECKING,
  DATABASE_RECOVERY_STATUS.MIGRATING,
  DATABASE_RECOVERY_STATUS.RECOVERY_REQUIRED,
  DATABASE_RECOVERY_STATUS.FAILED
]);

const SAFE_MIGRATION_PHASES = new Set([
  'backup_starting',
  'backup_complete',
  'rebuild_starting',
  'rebuild_complete',
  'restore_invalid_backup_entry',
  'restore_collision',
  'validation_failed'
]);

const describeRecovery = (state, hasActiveNativeRequest) => {
  if (
    state.status === DATABASE_RECOVERY_STATUS.IDLE
    || state.status === DATABASE_RECOVERY_STATUS.CHECKING
  ) {
    return {
      title: 'Comprobando la base local...',
      body: 'Lanzo está verificando que la base local pueda abrirse de forma segura.',
      icon: 'database'
    };
  }

  if (state.errorCode === 'DB_UNSUPPORTED_NATIVE_VERSION') {
    return {
      title: 'Esta versión de Lanzo no puede abrir tu base local',
      body: 'La comprobación no pudo abrir la base local. Esta instalación no puede acceder a ella de forma segura.',
      advice: 'No borres los datos de la aplicación. Actualiza Lanzo o envía el diagnóstico a soporte para que podamos revisar tu instalación.',
      icon: 'warning'
    };
  }

  if (state.errorCode === 'TENANT_DIRECTORY_CORRUPT') {
    return {
      title: 'El almacenamiento local de este tenant no puede abrirse de forma segura',
      body: 'Lanzo detectó que no puede localizar de forma segura la base local de este tenant. Esta comprobación no ejecutó una limpieza de datos.',
      advice: 'No crees ni restablezcas una base local. Puedes reintentar o enviar el diagnóstico a soporte para una revisión segura.',
      icon: 'warning'
    };
  }

  if (state.status === DATABASE_RECOVERY_STATUS.MIGRATING) {
    return {
      title: 'Preparando una actualización de la base local...',
      body: 'Lanzo está comprobando y preparando la base local. No cierres esta pestaña durante el proceso.',
      icon: 'database'
    };
  }

  if (state.errorCode === 'DB_BLOCKED') {
    return {
      title: 'Cierra las demás pestañas de Lanzo',
      body: 'La base local está siendo usada por otra pestaña o ventana. Lanzo esperará a que se cierre la conexión bloqueante antes de continuar; el estado de las operaciones locales debe verificarse al volver a abrir.',
      icon: 'warning'
    };
  }

  if (state.errorCode === 'DB_OPEN_TIMEOUT') {
    return {
      title: 'La apertura de la base local tardó demasiado',
      body: hasActiveNativeRequest
        ? 'El navegador todavía mantiene una solicitud activa. Espera a que termine antes de intentar otra recuperación.'
        : 'La solicitud anterior ya terminó. Puedes reintentar la recuperación de forma segura o recargar Lanzo.',
      icon: 'warning'
    };
  }

  if (state.errorCode === 'DB_BROWSER_STORAGE_UNAVAILABLE') {
    return {
      title: 'No se pudo abrir el almacenamiento local del navegador',
      body: 'Lanzo requiere IndexedDB para operar de forma segura. El sistema permanece bloqueado para proteger los datos del negocio.',
      advice: 'Cierra otras pestañas de Lanzo y vuelve a intentar. No borres los datos del navegador ni dependas de otorgar almacenamiento persistente para resolver este diagnóstico.',
      icon: 'warning'
    };
  }

  if (
    state.errorCode === 'DB_PRIMARY_KEY_MISMATCH'
    || state.errorCode === 'DB_CLOSED_AFTER_STRUCTURAL_ERROR'
    || state.requiresMigration
  ) {
    return {
      title: 'Actualización segura de la base local',
      body: 'Detectamos un esquema local que requiere migración. Mantén esta pestaña abierta durante el proceso y verifica ventas, inventario y movimientos antes de continuar operando.',
      icon: 'database'
    };
  }

  if (state.status === DATABASE_RECOVERY_STATUS.FAILED) {
    return {
      title: 'La recuperación automática no pudo completarse',
      body: 'La recuperación no pudo confirmar el estado completo de la base local. Mantén esta instalación sin operar y solicita una revisión técnica con el código de diagnóstico mostrado.',
      icon: 'warning'
    };
  }

  return {
    title: 'La base local necesita recuperación',
    body: 'El flujo no ejecuta un vaciado general de la base local. Su estado debe verificarse antes de continuar; cierra otras pestañas de Lanzo y reintenta.',
    icon: 'warning'
  };
};

const MigrationDetails = ({ migration }) => {
  const phase = SAFE_MIGRATION_PHASES.has(migration?.phase) ? migration.phase : null;
  if (!phase) return null;

  return (
    <div className="app-boot-recovery__details" aria-label="Progreso de migración">
      <p><strong>Fase:</strong> {phase}</p>
    </div>
  );
};

export default function DatabaseRecoveryGate({
  children,
  reloadPage = () => window.location.reload(),
  openSupportMailto = (url) => { window.location.href = url; }
}) {
  const recovery = useDatabaseRecoveryState();
  const nativeOperations = useNativeDatabaseOperationState();
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState('');
  const [supportActionError, setSupportActionError] = useState('');
  const [copied, setCopied] = useState(false);
  const [incidentRecord, setIncidentRecord] = useState(null);
  const [isOnline, setIsOnline] = useState(() => globalThis.navigator?.onLine !== false);
  const retryPromiseRef = useRef(null);
  const copyTimeoutRef = useRef(null);

  useEffect(() => {
    const updateOnlineState = () => setIsOnline(globalThis.navigator?.onLine !== false);
    window.addEventListener('online', updateOnlineState);
    window.addEventListener('offline', updateOnlineState);
    return () => {
      window.removeEventListener('online', updateOnlineState);
      window.removeEventListener('offline', updateOnlineState);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (recovery.status !== DATABASE_RECOVERY_STATUS.FAILED) {
      setIncidentRecord(null);
      return;
    }
    setIncidentRecord(captureIncident(
      Object.assign(new Error('IndexedDB recovery requires review'), { code: recovery.errorCode }),
      {
        source: 'indexeddb',
        category: 'indexeddb',
        severity: 'critical_blocker',
        recoveryStatus: 'failed'
      }
    ));
  }, [recovery.status, recovery.errorCode]);

  const supportReport = useMemo(() => (recovery.status === DATABASE_RECOVERY_STATUS.FAILED
    ? buildDatabaseRecoverySupportReport(recovery, { online: isOnline })
    : null), [recovery, isOnline]);

  if (!BLOCKING_STATUSES.has(recovery.status)) return children;

  const hasActiveNativeRequest = nativeOperations.length > 0;
  const copy = describeRecovery(recovery, hasActiveNativeRequest);
  const operationActive = retrying
    || hasActiveNativeRequest
    || isLocalDatabasePreparationActive();
  const canRetry = (
    recovery.status === DATABASE_RECOVERY_STATUS.RECOVERY_REQUIRED
    || (
      recovery.status === DATABASE_RECOVERY_STATUS.FAILED
      && recovery.errorCode === 'DB_BROWSER_STORAGE_UNAVAILABLE'
    )
  )
    && recovery.isRetryable !== false
    && recovery.errorCode !== 'DB_BLOCKED';
  const canReload = !hasActiveNativeRequest && (
    recovery.errorCode === 'DB_OPEN_TIMEOUT'
    || recovery.errorCode === 'TENANT_DIRECTORY_CORRUPT'
  );

  const sendSupportReport = () => {
    if (!supportReport) return;
    const safeCode = getSafeIncidentCode({ code: recovery.errorCode }, INCIDENT_CATEGORY.INDEXEDDB);
    openSupportMailto(buildSupportMailtoUrl({
      subject: `[Soporte Lanzo POS] Recuperación local - ${safeCode}`,
      body: supportReport
    }));
  };

  const copySupportReport = async () => {
    if (!supportReport) return;
    setSupportActionError('');
    const copiedSuccessfully = await copyTextToClipboard(supportReport);
    if (!copiedSuccessfully) {
      setSupportActionError('No se pudo copiar el diagnóstico automáticamente. Intenta nuevamente desde un navegador compatible.');
      return;
    }
    setCopied(true);
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setCopied(false), 3_000);
  };

  const retry = () => {
    if (retryPromiseRef.current) return retryPromiseRef.current;

    setRetrying(true);
    setRetryError('');
    const operation = retryLocalDatabaseRecovery()
      .then(() => {
        const finalState = getDatabaseRecoveryState();
        if (finalState.status !== DATABASE_RECOVERY_STATUS.READY) {
          throw new Error('La base local no alcanzó un estado seguro después del reintento.');
        }
        reloadPage();
      })
    .catch(() => {
        const safeCode = getSafeIncidentCode({ code: recovery.errorCode }, INCIDENT_CATEGORY.INDEXEDDB);
        setRetryError(`No se pudo completar el reio�7��$z{-���jםStackAvailable: Boolean(errorInfo?.componentStack),
    });

    this.setState({
      recoveryStatus: this._renderRecoveryAttempts > 0 ? 'failed' : (
        incident.severity === 'critical_blocker' ? 'blocked' : 'action_required'
      )
    });
    if (this._renderRecoveryAttempts > 0) {
      this._focusTimeout = globalThis.setTimeout(() => {
        this._focusTimeout = null;
        if (this.state.hasError) this._headingRef.current?.focus({ preventScroll: true });
      }, 0);
    }
  }

  componentDidUpdate(prevProps, prevState) {
    if (prevProps.resetKey !== this.props.resetKey) {
      this._renderRecoveryAttempts = 0;
      this._pwaUpdateAttempted = false;
      this._isRecoveryContextCurrent = null;
    }

    if (
      prevState.hasError
      && !this.state.hasError
      && this.state.recoveryStatus === 'recovering'
    ) {
      this._renderRecoveryAttempts = 0;
      this.setState({
        recoveryStatus: 'verified',
        recoveryActionMessage: 'La sección volvió a mostrarse correctamente.'
      });
      this._focusTimeout = globalThis.setTimeout(() => {
        this._focusTimeout = null;
        this._focusRestoredContent();
      }, 0);
    }

    if (!prevState.hasError && this.state.hasError && this._renderRecoveryAttempts > 0) {
      this.setState({
        recoveryStatus: 'failed',
        recoveryActionMessage: 'El reintento no resolvió el problema. No seguiremos reiniciando esta sección.'
      });
      this._headingRef.current?.focus({ preventScroll: true });
    }

    if (!prevState.hasError && this.state.hasError && this._incident().severity === 'critical_blocker') {
      this._setCriticalBlocker(true);
      this._headingRef.current?.focus({ preventScroll: true });
    } else if (prevState.hasError && !this.state.hasError) {
      this._setCriticalBlocker(false);
    }
  }

  componentWillUnmount() {
    if (this._copyTimeout) clearTimeout(this._copyTimeout);
    if (this._focusTimeout) clearTimeout(this._focusTimeout);
    this._unsubscribeAppStore?.();
    this._setCriticalBlocker(false);
  }

  _setCriticalBlocker(isActive) {
    if (isActive) {
      const root = document.getElementById('root');
      if (!root || this._criticalRoot) return;
      this._criticalRoot = root;
      this._criticalRootWasInert = Boolean(root.inert);
      this._criticalRootAriaHidden = root.getAttribute('aria-hidden');
      root.inert = true;
      root.setAttribute('aria-hidden', 'true');
      return;
    }

    if (!this._criticalRoot) return;
    this._criticalRoot.inert = this._criticalRootWasInert;
    if (this._criticalRootAriaHidden === null) {
      this._criticalRoot.removeAttribute('aria-hidden');
    } else {
      this._criticalRoot.setAttribute('aria-hidden', this._criticalRootAriaHidden);
    }
    this._criticalRoot = null;
  }

  _incident() {
    return classifyIncident(this.state.error, {
      source: 'react',
      ...(this.props.incidentContext || {})
    });
  }

  _hasCurrentRecoveryContext() {
    try {
      return typeof this._isRecoveryContextCurrent === 'function'
        && this._isRecoveryContextCurrent() === true;
    } catch {
      return false;
    }
  }

  _focusRestoredContent() {
    const root = document.getElementById('root');
    if (!root || this.state.hasError) return;
    const target = root.querySelector(
      '[data-recovery-focus-target], main h1, main h2, [role="main"] h1, [role="main"] h2'
    ) || root;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus?.({ preventScroll: true });
  }

  _buildReportMessage() {
    const { error, crashTimestamp } = this.state;
    return buildSafeIncidentReport(error, {
      source: 'react',
      ...(this.props.incidentContext || {})
    }, {
      pathname: window.location.pathname,
      online: navigator.onLine !== false,
      appVersion: import.meta.env.VITE_APP_VERSION,
      buildCommit: import.meta.env.VITE_BUILD_COMMIT,
      userAgent: navigator.userAgent,
      now: crashTimestamp ? new Date(crashTimestamp) : new Date(),
    });
  }

  _buildMetadata(incident) {
    const metadata = getSafeIncidentMetadata({
      ...incident,
      recoveryStatus: this.state.recoveryStatus
    }, {
      pathname: window.location.pathname,
      online: navigator.onLine !== false,
      appVersion: import.meta.env.VITE_APP_VERSION,
      now: this.state.crashTimestamp || new Date()
    });

    return {
      ...metadata,
      formattedTimestamp: formatTimestamp(metadata.timestamp)
    };
  }

  handleReport = () => {
    const mailtoUrl = buildSupportMailtoUrl({
      subject: 'Reporte de incidencia técnica - Lanzo POS',
      body: this._buildReportMessage()
    });
    const openSupportMailto = this.props.openSupportMailto
      || ((url) => { window.location.href = url; });
    openSupportMailto(mailtoUrl);
  }

  handleCopy = async () => {
    this.setState({ copyError: '' });
    const copiedSuccessfully = await copyTextToClipboard(this._buildReportMessage());
    if (copiedSuccessfully !== true) {
      this.setState({
        copyError: 'No se pudo copiar el diagnóstico. Intenta desde un navegador compatible.'
      });
      return;
    }
    this.setState({ copied: true });
    this._copyTimeout = setTimeout(() => this.setState({ copied: false }), 3000);
  }

  handleForceUpdateApp = async () => {
    if (!this._hasCurrentRecoveryContext()) {
      this.setState({
        recoveryStatus: 'blocked',
        recoveryActionMessage: 'La sesión o el contexto de negocio cambió. Vuelve a abrir esta sección desde el contexto actual.'
      });
      return null;
    }
    if (!areActorOperationsIdle()) {
      this.setState({
        recoveryStatus: 'blocked',
        recoveryActionMessage: 'Hay una operación en curso. La actualización no se iniciará hasta que termine.'
      });
      return null;
    }
    if (this._recoveryPromise || this.state.isRecoveryUpdating || this._pwaUpdateAttempted) {
      return this._recoveryPromise;
    }

    const appState = useAppStore.getState();
    if (!appState.updateAvailable || typeof appState.runUpdate !== 'function') {
      this.setState({
        recoveryStatus: 'action_required',
        recoveryActionMessage: 'No hay una actualización confirmada disponible.'
      });
      return null;
    }
    if (navigator.onLine === false) {
      this.setState({
        recoveryStatus: 'blocked',
        recoveryActionMessage: 'Estás sin conexión. Conservamos la versión instalada y no iniciaremos una actualización.'
      });
      return null;
    }

    this._pwaUpdateAttempted = true;
    this.setState({
      isRecoveryUpdating: true,
      recoveryStatus: 'recovering',
      recoveryActionMessage: 'Comprobando la actualización disponible…'
    });
    const operation = Promise.resolve()
      .then(() => appState.runUpdate())
      .then(() => {
        const latestState = useAppStore.getState();
        if (latestState.updateAvailable || latestState.isUpdating) {
          throw new Error('PWA_UPDATE_NOT_APPLIED');
        }
        this.setState({
          recoveryStatus: 'verified',
          recoveryActionMessage: 'La actualización fue confirmada. Lanzo reanudará el acceso cuando sea seguro.'
        });
      })
      .catch((error) => {
        const incident = classifyIncident(error, { category: 'pwa' });
        Logger.warn('No se pudo aplicar la actualización PWA.', {
          code: incident.code,
          category: incident.category,
          severity: incident.severity,
        });
        this.setState({
          recoveryStatus: 'failed',
          recoveryActionMessage: 'No se pudo confirmar la actualización. Verifica cualquier operación pendiente antes de intentarlo de nuevo.'
        });
      })
      .finally(() => {
        this._recoveryPromise = null;
        this.setState({ isRecoveryUpdating: false });
      });
    this._recoveryPromise = operation;
    return operation;
  }

  handleReset = () => {
    if (!this._hasCurrentRecoveryContext()) {
      this.setState({
        recoveryStatus: 'blocked',
        recoveryActionMessage: 'La sesión o el contexto de negocio cambió desde el error. Vuelve a abrir esta sección desde el contexto actual.'
      });
      return;
    }
    if (this._renderRecoveryAttempts >= 1) {
      this.setState({
        recoveryStatus: 'failed',
        recoveryActionMessage: 'El reintento no resolvió el problema. No seguiremos reiniciando esta sección.'
      });
      return;
    }
    this._renderRecoveryAttempts += 1;
    this.setState({
      hasError: false,
      error: null,
      crashTimestamp: null,
      copied: false,
      isRecoveryUpdating: false,
      recoveryActionMessage: 'Recuperando esta sección…',
      recoveryStatus: 'recovering'
    });
  }

  handleGoToPos = () => {
    if (!this._hasCurrentRecoveryContext()) {
      this.setState({
        recoveryStatus: 'blocked',
        recoveryActionMessage: 'La sesión o el contexto de negocio cambió desde el error. Vuelve a abrir esta sección desde el contexto actual.'
      });
      return;
    }
    if (!areActorOperationsIdle()) {
      this.setState({
        recoveryStatus: 'blocked',
        recoveryActionMessage: 'Hay una operación en curso. Termínala antes de cambiar de sección.'
      });
      return;
    }
    const navigateToPos = this.props.navigateToPos || ((path) => window.location.replace(path));
    navigateToPos('/');
  }

  render() {
    if (!this.state.hasError) {
      if (this.state.recoveryStatus === 'recovering') {
        return (
          <>
            <span className="incident-recovery__sr-only" role="status" aria-live="polite">
              Recuperación en curso
            </span>
            {this.props.children}
          </>
        );
      }
      if (this.state.recoveryStatus === 'verified') {
        return (
          <>
            <span className="incident-recovery__sr-only" role="status" aria-live="polite">
              {this.state.recoveryActionMessage}
            </span>
            {this.props.children}
          </>
        );
      }
      return this.props.children;
    }

    const incident = this._incident();
    const metadata = this._buildMetadata(incident);
    const isCritical = incident.severity === 'critical_blocker';
    const isRecoverable = incident.severity === 'recoverable';
    const currentPath = getRouteLabel(window.location.pathname);
    const isOnline = navigator.onLine !== false;
    const contextCurrent = this._hasCurrentRecoveryContext();
    const updateAvailable = this.state.updateAvailable;
    const canShowUpdateAction = !isCritical
      && contextCurrent
      && updateAvailable
      && isOnline
      && areActorOperationsIdle()
      && typeof useAppStore.getState()?.runUpdate === 'function';
    const canGoHome = !isCritical
      && contextCurrent
      && currentPath !== '/'
      && incident.category !== 'financial_operation'
      && areActorOperationsIdle();
    const criticalCopy = isCritical ? getCriticalCopy(incident) : null;
    const retryDisabled = !contextCurrent || this._renderRecoveryAttempts >= 1;

    let title = isRecoverable
      ? 'No pudimos cargar esta información'
      : 'No pudimos mostrar esta sección';
    let description = isRecoverable
      ? 'Puedes intentarlo nuevamente. El resto de Lanzo POS sigue disponible.'
      : 'Ocurrió un problema inesperado. Puedes recuperar esta sección sin reiniciar todo Lanzo POS.';
    if (isCritical) {
      title = criticalCopy.title;
      description = criticalCopy.description;
    }

    const primaryAction = isCritical
      ? {
        label: 'Abrir correo de soporte',
        onClick: this.handleReport,
        icon: <Mail size={18} aria-hidden="true" />
      }
      : canShowUpdateAction
        ? {
          label: this.state.isRecoveryUpdating || this.state.isUpdateRunning
            ? 'Actualizando aplicación…'
            : 'Actualizar aplicación',
          onClick: this.handleForceUpdateApp,
          icon: <RefreshCw size={18} aria-hidden="true" />,
          disabled: this.state.isRecoveryUpdating || this.state.isUpdateRunning || this._pwaUpdateAttempted,
          busy: this.state.isRecoveryUpdating || this.state.isUpdateRunning,
          disabledReason: this.state.isUpdateRunning
            ? 'La actualización ya está en curso.'
            : this._pwaUpdateAttempted
              ? 'Este intento de actualización ya se utilizó.'
              : ''
        }
        : {
          label: retryDisabled
            ? this._renderRecoveryAttempts >= 1 ? 'Reintento utilizado' : 'Reabrir sección desde el contexto actual'
            : isRecoverable ? 'Reintentar' : 'Reintentar sección',
          onClick: this.handleReset,
          icon: <RefreshCw size={18} aria-hidden="true" />,
          disabled: retryDisabled,
          disabledReason: retryDisabled
            ? this._renderRecoveryAttempts >= 1
              ? 'El reintento disponible ya se utilizó.'
              : 'El contexto de sesión o negocio cambió; vuelve a abrir la sección.'
            : ''
        };

    const secondaryActions = [];
    if (!isCritical && canGoHome) {
      secondaryActions.push({
        label: 'Volver al inicio',
        onClick: this.handleGoToPos,
        icon: <ArrowRightCircle size={17} aria-hidden="true" />
      });
    }
    if (!isCritical) {
      secondaryActions.push({
        label: 'Abrir correo de soporte',
        onClick: this.handleReport,
        icon: <Mail size={17} aria-hidden="true" />
      });
    }

    let operationDetails = criticalCopy?.operationDetails || null;
    if (!operationDetails && incident.category === 'financial_operation') {
      operationDetails = {
        title: 'Antes de repetir una operación',
        description: 'Este problema no confirma por sí solo que haya datos perdidos. Si hay un cobro pendiente, revisa su resultado antes de intentarlo nuevamente.'
      };
    }

    const panel = (
      <IncidentRecoveryPanel
        severity={incident.severity}
        title={title}
        description={description}
        metadata={metadata}
        primaryAction={primaryAction}
        secondaryActions={secondaryActions}
        operationDetails={operationDetails}
        copied={this.state.copied}
        onCopy={this.handleCopy}
        copyError={this.state.copyError}
        incidentRecord={this._incidentRecord}
        isContextCurrent={() => this._hasCurrentRecoveryContext()}
        recoveryNotice={this.state.recoveryActionMessage || (!isOnline ? 'Estás trabajando sin conexión.' : '')}
        contactNote="Se abrirá tu aplicación de correo. Revisa el mensaje y envíalo cuando estés listo."
        titleRef={this._headingRef}
      />
    );
    return isCritical && typeof document !== 'undefined' && document.body
      ? createPortal(panel, document.body)
      : panel;
  }
}

export default ErrorBoundary;
