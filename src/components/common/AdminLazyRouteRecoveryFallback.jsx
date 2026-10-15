import { useEffect, useRef, useState } from 'react';
import { ArrowRightCircle, Mail, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  buildSafeIncidentReport,
  classifyIncident,
  getSafeIncidentMetadata
} from '../../services/diagnostics/incidentDiagnostics';
import { buildSupportMailtoUrl, copyTextToClipboard } from '../../services/support/supportContact';
import {
  getActorCheckoutOwnerships,
  getPendingActorOperations
} from '../../services/auth/actorOperationalHandoff';
import { recoverAdminLazyRoute } from '../../pwa/adminLazyRouteRecovery';
import { isRecoverableAdminStartupError } from '../../pwa/adminStartupRecovery';
import IncidentRecoveryPanel from './IncidentRecoveryPanel';
import './ErrorBoundary.css';

const areActorOperationsIdle = () => {
  try {
    return getActorCheckoutOwnerships().length === 0
      && getPendingActorOperations().length === 0;
  } catch {
    return false;
  }
};

const describeRecoveryResult = (status) => {
  const messages = {
    'stale-context': 'La sesión o el contexto de negocio cambió. Vuelve a abrir la sección desde el contexto actual.',
    'operation-active': 'Hay una operación en curso. La actualización no se iniciará hasta que termine.',
    offline: 'Estás sin conexión. La versión instalada se conserva; vuelve a intentarlo cuando tengas conexión.',
    'already-attempted': 'Este intento de recuperación ya se utilizó. Solicita ayuda antes de volver a intentarlo.',
    unavailable: 'No se pudo iniciar la recuperación de esta sección.',
    'not-recoverable': 'Este error no corresponde a una actualización de archivos.'
  };
  return messages[status] || 'No se pudo confirmar la recuperación. Contacta a soporte antes de intentarlo de nuevo.';
};

export default function AdminLazyRouteRecoveryFallback({
  error,
  isContextCurrent,
  initialRecoveryStatus = 'action_required',
  initiallyOffline = false,
  initiallyStale = false
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [recoveryStatus, setRecoveryStatus] = useState(
    initiallyStale ? 'blocked' : initialRecoveryStatus
  );
  const [recoveryNotice, setRecoveryNotice] = useState(
    initiallyStale
      ? describeRecoveryResult('stale-context')
      : initiallyOffline
        ? describeRecoveryResult('offline')
        : ''
  );
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const headingRef = useRef(null);
  const copyTimeoutRef = useRef(null);
  const incident = classifyIncident(error, {
    source: 'react',
    severity: 'section_failure'
  });
  const metadata = getSafeIncidentMetadata({
    ...incident,
    recoveryStatus
  }, {
    pathname: window.location.pathname,
    online: navigator.onLine !== false,
    appVersion: import.meta.env.VITE_APP_VERSION
  });
  const canForceRecovery = isRecoverableAdminStartupError(error);
  const operationsIdle = areActorOperationsIdle();
  let contextCurrent = false;
  try {
    contextCurrent = typeof isContextCurrent === 'function' && isContextCurrent();
  } catch {
    contextCurrent = false;
  }
  const canRecover = canForceRecovery
    && navigator.onLine !== false
    && contextCurrent
    && operationsIdle
    && !attempted;
  const currentPath = window.location.pathname;
  const canGoHome = currentPath !== '/' && operationsIdle && contextCurrent;

  useEffect(() => () => {
    if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
  }, []);

  const handleRecovery = async () => {
    if (!canRecover || busy) return;
    setAttempted(true);
    setBusy(true);
    setRecoveryStatus('recovering');
    setRecoveryNotice('Comprobando si los archivos de esta sección se pueden recuperar…');
    try {
      const result = await recoverAdminLazyRoute({
        error,
        force: true,
        isContextCurrent
      });
      if (result?.status === 'reloading') return;
      const status = result?.status || 'unavailable';
      const nextRecoveryStatus = ['stale-context', 'offline', 'operation-active'].includes(status)
        ? 'blocked'
        : 'failed';
      setRecoveryStatus(nextRecoveryStatus);
      setRecoveryNotice(describeRecoveryResult(status));
      headingRef.current?.focus({ preventScroll: true });
    } catch {
      setRecoveryStatus('failed');
      setRecoveryNotice(describeRecoveryResult('unavailable'));
      headingRef.current?.focus({ preventScroll: true });
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    setCopyError('');
    const report = buildSafeIncidentReport(error, { source: 'react' }, {
      pathname: window.location.pathname,
      online: navigator.onLine !== false,
      appVersion: import.meta.env.VITE_APP_VERSION,
      userAgent: navigator.userAgent
    });
    const copiedSuccessfully = await copyTextToClipboard(report);
    if (!copiedSuccessfully) {
      setCopyError('No se pudo copiar el diagnóstico. Intenta desde un navegador compatible.');
      return;
    }
    setCopied(true);
    if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = window.setTimeout(() => setCopied(false), 3000);
  };

  const handleContact = () => {
    const body = buildSafeIncidentReport(error, { source: 'react' }, {
      pathname: window.location.pathname,
      online: navigator.onLine !== false,
      appVersion: import.meta.env.VITE_APP_VERSION,
      userAgent: navigator.userAgent
    });
    window.location.href = buildSupportMailtoUrl({
      subject: 'Reporte de sección no disponible - Lanzo POS',
      body
    });
  };

  const secondaryActions = [];
  if (canGoHome && canRecover) {
    secondaryActions.push({
      label: 'Volver al inicio',
      onClick: () => navigate('/'),
      icon: <ArrowRightCircle size={17} aria-hidden="true" />
    });
  }
  secondaryActions.push({
    label: 'Abrir correo de soporte',
    onClick: handleContact,
    icon: <Mail size={17} aria-hidden="true" />
  });

  let primaryAction = null;
  if (canRecover) {
    primaryAction = {
      label: busy ? 'Recuperando sección…' : 'Actualizar archivos de la sección',
      onClick: handleRecovery,
      disabled: busy || attempted,
      busy,
      icon: <RefreshCw size={18} aria-hidden="true" />
    };
  } else if (canGoHome) {
    primaryAction = {
      label: 'Volver al inicio',
      onClick: () => navigate('/'),
      icon: <ArrowRightCircle size={18} aria-hidden="true" />
    };
  }

  return (
    <IncidentRecoveryPanel
      severity="section_failure"
      title="No pudimos mostrar esta sección"
      description={metadata.section === 'otra sección'
        ? 'Ocurrió un problema al abrir esta sección. Puedes recuperar sus archivos sin reiniciar todo Lanzo POS.'
        : 'Ocurrió un problema al abrir ' + metadata.section + '. Puedes recuperar sus archivos sin reiniciar todo Lanzo POS.'}
      metadata={metadata}
      primaryAction={primaryAction}
      secondaryActions={secondaryActions}
      onCopy={handleCopy}
      copied={copied}
      copyError={copyError}
      recoveryNotice={recoveryNotice}
      contactNote="Se abrirá tu aplicación de correo. Revisa el mensaje y envíalo cuando estés listo."
      titleRef={headingRef}
    />
  );
}
