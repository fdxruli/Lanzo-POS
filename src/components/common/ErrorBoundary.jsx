import React from 'react';
import { createPortal } from 'react-dom';
import { Mail, RefreshCw, ArrowRightCircle } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import Logger from '../../services/Logger';
import { buildSupportMailtoUrl, copyTextToClipboard } from '../../services/support/supportContact';
import {
  buildSafeIncidentReport,
  classifyIncident,
  getSafeIncidentMetadata
} from '../../services/diagnostics/incidentDiagnostics';
import { captureIncident } from '../../services/diagnostics/incidentCapture';
import { createRecoveryContextGuard } from '../../services/diagnostics/recoveryContext';
import {
  getActorCheckoutOwnerships,
  getPendingActorOperations
} from '../../services/auth/actorOperationalHandoff';
import IncidentRecoveryPanel from './IncidentRecoveryPanel';
import './ErrorBoundary.css';

const getRouteLabel = (pathname) => {
  const path = typeof pathname === 'string' ? pathname.split(/[?#]/, 1)[0] : '/';
  return path || '/';
};

const formatTimestamp = (isoString) => {
  try {
    return new Date(isoString).toLocaleString('es-MX', {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  } catch {
    return 'No disponible';
  }
};

const areActorOperationsIdle = () => {
  try {
    return getActorCheckoutOwnerships().length === 0
      && getPendingActorOperations().length === 0;
  } catch {
    return false;
  }
};

const getCriticalCopy = (incident) => {
  if (incident.category === 'financial_operation') {
    return {
      title: 'Necesitamos verificar esta operación',
      description: 'No pudimos confirmar el resultado. Para evitar duplicaciones, algunas acciones permanecerán temporalmente bloqueadas.',
      operationDetails: {
        title: 'Resultado de cobro no confirmado',
        description: 'No vuelvas a registrar ni a repetir esta operación hasta comprobar su resultado.',
        blockedActions: ['Repetir el cobro', 'Cancelar la operación sin revisar su estado'],
        verification: 'Consulta el recibo o ledger canónico con soporte antes de continuar.'
      }
    };
  }

  if (incident.category === 'indexeddb') {
    return {
      title: 'Necesitamos revisar el almacenamiento local',
      description: 'Lanzo no puede confirmar que esta sección pueda continuar de forma segura. Mantendremos el acceso bloqueado mientras se verifica el estado.',
      operationDetails: {
        title: 'Almacenamiento local',
        description: 'No cierres ni borres los datos del navegador para intentar resolver este problema.',
        blockedActions: ['Continuar operaciones que requieren esta base local'],
        verification: 'Solicita una revisión con el diagnóstico seguro de esta pantalla.'
      }
    };
  }

  return {
    title: 'Necesitamos revisar esta sección',
    description: 'No podemos confirmar que sea seguro continuar desde aquí. Algunas acciones permanecerán bloqueadas mientras se revisa el estado.',
    operationDetails: {
      title: 'Verificación necesaria',
      description: 'La sección afectada seguirá bloqueada hasta revisar el diagnóstico.',
      blockedActions: ['Reintentar una acción cuyo resultado no se haya confirmado'],
      verification: 'Contacta a soporte antes de reanudar esta operación.'
    }
  };
};

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      crashTimestamp: null,
      copied: false,
      copyError: '',
      isRecoveryUpdating: false,
      recoveryActionMessage: '',
      recoveryStatus: 'detected',
      updateAvailable: Boolean(useAppStore.getState()?.updateAvailable),
      isUpdateRunning: Boolean(useAppStore.getState()?.isUpdating),
      resetKey: props.resetKey
    };
    this._copyTimeout = null;
    this._focusTimeout = null;
    this._recoveryPromise = null;
    this._renderRecoveryAttempts = 0;
    this._pwaUpdateAttempted = false;
    this._isRecoveryContextCurrent = null;
    this._incidentRecord = null;
    this._unsubscribeAppStore = null;
    this._headingRef = React.createRef();
    this._criticalRoot = null;
    this._criticalRootWasInert = false;
    this._criticalRootAriaHidden = null;
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      error,
      crashTimestamp: new Date().toISOString(),
      recoveryStatus: 'detected'
    };
  }

  static getDerivedStateFromProps(props, state) {
    if (props.resetKey !== state.resetKey) {
      return {
        hasError: false,
        error: null,
        crashTimestamp: null,
        copied: false,
        copyError: '',
        isRecoveryUpdating: false,
        recoveryActionMessage: '',
        recoveryStatus: 'detected',
        resetKey: props.resetKey
      };
    }
    return null;
  }

  componentDidMount() {
    if (typeof useAppStore.subscribe === 'function') {
      this._unsubscribeAppStore = useAppStore.subscribe((nextState) => {
        const updateAvailable = Boolean(nextState?.updateAvailable);
        const isUpdateRunning = Boolean(nextState?.isUpdating);
        if (
          updateAvailable !== this.state.updateAvailable
          || isUpdateRunning !== this.state.isUpdateRunning
        ) {
          this.setState({ updateAvailable, isUpdateRunning });
        }
      });
    }
  }

  componentDidCatch(error, errorInfo) {
    const createContextGuard = this.props.createRecoveryContextGuard || createRecoveryContextGuard;
    this._isRecoveryContextCurrent = createContextGuard();
    const incident = classifyIncident(error, {
      source: 'react',
      ...(this.props.incidentContext || {})
    });
    this._incidentRecord = captureIncident(error, {
      source: 'react',
      ...(this.props.incidentContext || {}),
      recoveryStatus: this._renderRecoveryAttempts > 0 ? 'failed' : 'action_required'
    });
    if (incident.severity === 'critical_blocker') {
      this._setCriticalBlocker(true);
      this._headingRef.current?.focus({ preventScroll: true });
    }
    Logger.error('Error de interfaz capturado.', {
      timestamp: new Date().toISOString(),
      code: incident.code,
      category: incident.category,
      severity: incident.severity,
      errorType: incident.errorType,
      componentStackAvailable: Boolean(errorInfo?.componentStack),
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
