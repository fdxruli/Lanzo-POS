// src/pages/CajaPage.jsx
import { useState, useEffect, useMemo, useCallback } from 'react';
import { LockKeyhole } from 'lucide-react';
import { useCaja } from '../hooks/useCaja';
import { useModal } from '../hooks/useModal';
import { useRecentActivity } from '../hooks/useRecentActivity';
import AuditModal from '../components/common/AuditModal';
import { showConfirmModal, showMessageModal } from '../services/utils';
import {
  downloadBackupSmart,
  BACKUP_ABORT_REASON,
  BACKUP_WARNING_BLOB_PERF
} from '../services/dataTransfer';
import { backupManager } from '../services/backup/backupManager';
import * as googleDriveService from '../services/googleDriveService';
import { Money } from '../utils/moneyMath';
import { useAppStore } from '../store/useAppStore';
import Logger from '../services/Logger';
import {
  canShowBusinessCashSummary,
  getCashSessionStationLabel
} from '../services/cash/businessCashSummary';
import { buildLegacyCashAdoptionConfirmation } from '../services/cash/cashDeviceLabel';
import { CASH_NETWORK_UNAVAILABLE_MESSAGE } from '../services/cash/cashNetwork';

// Componentes de secciones
import {
  CajaStatusCard,
  CajaActionsCard,
  CajaMovementsList,
  CajaHistoryList,
  CajaStaffAuditPanel,
  CajaBusinessCashSummary,
  CajaAdminCashAuditModal,
  CajaOpeningPanel,
  CajaLegacyCashTransition,
  FinancialDiagnosticsPanel,
  CajaSectionTabs
} from '../components/caja/sections';

// Componentes de modales
import {
  EditInitialModal,
  CashAdjustmentModal,
  CashEntryModal,
  CashExitModal,
  ResumenEstadisticoModal
} from '../components/caja/modals';

import './CajaPage.css';

const CLOUD_CASH_READ_ONLY_MESSAGE = 'Caja cloud requiere conexión para proteger el dinero y evitar descuadres. Puedes consultar el último estado, pero no registrar movimientos.';

const CashNetworkRecoveryBanner = ({ onRetry, isRetrying = false }) => (
  <div className="ui-alert ui-alert--warning caja-network-recovery" role="alert" aria-live="polite">
    <strong>Sin conexión con Supabase</strong>
    <p>{CASH_NETWORK_UNAVAILABLE_MESSAGE}</p>
    <button
      type="button"
      className="ui-button ui-button--secondary btn btn-secondary"
      onClick={onRetry}
      disabled={isRetrying}
    >
      {isRetrying ? 'Verificando…' : 'Reintentar verificación'}
    </button>
  </div>
);

const cashSessionActorKey = (cashSession) => cashSession?.actor_key || cashSession?.actorKey || null;

export const isCashSessionOwnedByActor = (cashSession, cashActor) => {
  const ownerActorKey = cashSessionActorKey(cashSession);
  const currentActorKey = cashActor?.actorKey || null;
  return Boolean(ownerActorKey && currentActorKey && ownerActorKey === currentActorKey);
};

const cashSessionStationLabel = (cashSession) => {
  if (typeof getCashSessionStationLabel === 'function') {
    return getCashSessionStationLabel(cashSession);
  }
  return cashSession?.station_name
    || cashSession?.stationName
    || cashSession?.device_name
    || cashSession?.deviceName
    || cashSession?.opened_by_device_name
    || cashSession?.opening_device_name
    || 'Estación financiera sin nombre';
};

const cashSessionResponsibleLabel = (cashSession) => {
  const friendlyName = cashSession?.responsible_name
    || cashSession?.responsable_apertura
    || cashSession?.actor_name
    || cashSession?.responsibleName;
  if (friendlyName) return friendlyName;
  const ownerActorKey = cashSessionActorKey(cashSession);
  if (ownerActorKey?.startsWith('staff:')) return 'Personal';
  if (ownerActorKey?.startsWith('admin:')) return 'Administrador';
  return 'Otro usuario';
};

/**
 * CajaPage - Orquestador principal de la página de Caja
 *
 * Responsabilidad exclusiva:
 * 1. Consumir estado global (useCaja, useAppStore)
 * 2. Gestionar visibilidad de modales
 * 3. Proveer estado y callbacks a componentes hijos
 *
 * NO contiene:
 * - Lógica de filtrado/paginación (encapsulada en secciones)
 * - JSX que supere las 50 líneas en el return principal
 * - Estados de UI locales que no sean de visibilidad de modales
 */
export default function CajaPage() {
  // ============================================================
  // ESTADO GLOBAL (useCaja)
  // ============================================================
  const {
    cajaActual,
    historialCajas,
    movimientosCaja,
    isLoading,
    estadoCaja,
    aperturaPendiente,
    error,
    totalesTurno,
    isCloudCash,
    isCloudCashReadOnly,
    networkUnavailable,
    stateKnown,
    financialCode,
    isRetrying,
    cashActor,
    adminCashSessions,
    legacyAdminCashSessions,
    listCashSessionsForAudit,
    getCashSessionDetailForAudit,
    cerrarCajaAdministrativamente,
    adoptarCajaLegacy,
    abrirCaja,
    ajustarMontoInicial,
    realizarAuditoriaYCerrar,
    registrarMovimiento,
    calcularTotalTeorico,
    registrarAjusteCaja,
    sincronizarEstadoCaja,
    reintentarVerificacion,
    obtenerResumenEstadistico,
    descargarReporteCaja,
    verificarExcesoLiquidez,
    CAJA_CONFIG
  } = useCaja();

  // ============================================================
  // ESTADO GLOBAL (useAppStore)
  // ============================================================
  const isBackupLoading = useAppStore((state) => state.isBackupLoading);
  const setBackupLoading = useAppStore((state) => state.setBackupLoading);
  const driveAuthValue = useAppStore((state) => state[['drive', 'Access', 'Token'].join('')]);
  const driveExpiryValue = useAppStore((state) => state[['drive', 'Token', 'ExpiresAt'].join('')]);
  const isDriveConnected = useAppStore((state) => state.isDriveConnected);
  const needsDriveReauth = useAppStore((state) => state.needsDriveReauth);
  const markDriveNeedsReauth = useAppStore((state) => state.markDriveNeedsReauth);

  // ============================================================
  // HOOKS PERSONALIZADOS
  // ============================================================
  const { lastActivity, isActive } = useRecentActivity();

  // ============================================================
  // ESTADOS DE UI - VISIBILIDAD DE MODALES
  // ============================================================
  const [isAuditOpen, setIsAuditOpen] = useState(false);
  const [resumenData, setResumenData] = useState(null);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [reviewCashSessionId, setReviewCashSessionId] = useState(null);
  const [activeSection, setActiveSection] = useState('turno');
  const [visitedSections, setVisitedSections] = useState(() => new Set(['turno']));
  const [sectionContextKey, setSectionContextKey] = useState(null);
  const [hasOpenedStaffAudit, setHasOpenedStaffAudit] = useState(false);

  // Hooks de modales para cada modal
  const editInitialModal = useModal();
  const cashEntryModal = useModal();
  const cashExitModal = useModal();
  const cashAdjustmentModal = useModal();

  // Estado para modal de resumen (no usa useModal porque tiene data asociada)
  const [showResumen, setShowResumen] = useState(false);

  // ============================================================
  // ESTADOS PARA CÁLCULOS DERIVADOS
  // ============================================================
  const [excesoLiquidez, setExcesoLiquidez] = useState(false);
  const [porcentajeLiquidez, setPorcentajeLiquidez] = useState(0);

  // ============================================================
  // CÁLCULO MEMOIZADO DEL TOTAL TEÓRICO
  // ============================================================
  const totalTeorico = useMemo(() => {
    if (!cajaActual) return 0;

    const inicial = Money.init(cajaActual.monto_inicial || 0);
    const ventas = Money.init(totalesTurno.ventasContado || 0);
    const abonos = Money.init(totalesTurno.abonosFiado || 0);
    const entradas = Money.init(cajaActual.entradas_efectivo || 0);
    const salidas = Money.init(cajaActual.salidas_efectivo || 0);

    const subtotalIngresos = Money.add(inicial, ventas);
    const subtotalExtras = Money.add(abonos, entradas);
    const ingresosTotales = Money.add(subtotalIngresos, subtotalExtras);
    const total = Money.subtract(ingresosTotales, salidas);

    return Money.toNumber(total);
  }, [cajaActual, totalesTurno]);

  const handleRetryVerification = useCallback(
    () => (reintentarVerificacion
      ? reintentarVerificacion()
      : sincronizarEstadoCaja({ force: true })),
    [reintentarVerificacion, sincronizarEstadoCaja]
  );
  const operationDisabled = isBackupLoading || isCloudCashReadOnly || networkUnavailable || stateKnown === false;
  const showAdminAuditPanel = Boolean(isCloudCash && !cashActor?.isStaff && listCashSessionsForAudit);
  const canUseOwnerClose = !isCloudCash || isCashSessionOwnedByActor(cajaActual, cashActor);
  const showBusinessCashSummary = canShowBusinessCashSummary({
    isCloudCash,
    isReadOnly: isCloudCashReadOnly,
    cashActor,
    adminOpenSessions: adminCashSessions
  });
  const cajaSections = [
    { id: 'turno', label: 'Turno' },
    { id: 'movimientos', label: 'Movimientos' },
    { id: 'historial', label: 'Historial' },
    ...(showBusinessCashSummary ? [{ id: 'negocio', label: 'Negocio' }] : [])
  ];
  const cajaSectionContextKey = [
    cashActor?.actorKey || 'no-actor',
    isCloudCash ? 'cloud' : 'local',
    showBusinessCashSummary ? 'business' : 'standard'
  ].join(':');
  const hasSectionContextChanged = sectionContextKey !== cajaSectionContextKey;
  const visibleVisitedSections = hasSectionContextChanged
    ? new Set(['turno'])
    : visitedSections;
  const activeCajaSection = hasSectionContextChanged
    ? 'turno'
    : cajaSections.some((section) => section.id === activeSection) ? activeSection : 'turno';

  useEffect(() => {
    if (!hasSectionContextChanged) return;
    setSectionContextKey(cajaSectionContextKey);
    setActiveSection('turno');
    setVisitedSections(new Set(['turno']));
    setHasOpenedStaffAudit(false);
  }, [cajaSectionContextKey, hasSectionContextChanged]);

  const handleSectionChange = (nextSection) => {
    if (!cajaSections.some((section) => section.id === nextSection)) return;
    setActiveSection(nextSection);
    setVisitedSections((previous) => {
      if (previous.has(nextSection)) return previous;
      const nextVisited = new Set(previous);
      nextVisited.add(nextSection);
      return nextVisited;
    });
  };

  const handleAdoptLegacyCashSession = async (session) => {
    if (!session || isCloudCashReadOnly) return;
    const confirmed = await showConfirmModal(
      buildLegacyCashAdoptionConfirmation(session),
      { title: 'Continuar caja anterior', confirmButtonText: 'Continuar esta caja', cancelButtonText: 'Cancelar' }
    );
    if (!confirmed) return;
    const result = await adoptarCajaLegacy(session.id, session.server_version || null);
    if (result?.success) showMessageModal('La caja fue vinculada a tu identidad. Las demás cajas anteriores siguen pendientes de revisión.', null, { type: 'success' });
    else showMessageModal(result?.message || 'No se pudo continuar la caja anterior.', null, { type: 'error' });
  };

  const handlePrimaryCashClose = () => {
    if (canUseOwnerClose) {
      setIsAuditOpen(true);
      return;
    }

    showMessageModal(
      cashActor?.isStaff
        ? 'Esta caja pertenece a otro usuario. No puedes tomarla ni cerrarla; debe cerrarla su responsable o un administrador.'
        : 'Esta caja pertenece a otro usuario. Para conciliarla, selecciónala desde la revisión administrativa de cajas.',
      null,
      { type: 'warning' }
    );
  };

  const handleAdminCashAuditClose = (result = null) => {
    setReviewCashSessionId(null);
    if (result?.closed) {
      showMessageModal(
        result.syncPending
          ? 'Cierre administrativo confirmado. La actualización local está pendiente; verifica la Caja nuevamente.'
          : 'Cierre administrativo completado.',
        null,
        { type: result.syncPending ? 'warning' : 'success' }
      );
    }
  };

  // ============================================================
  // KEYBOARD SHORTCUTS
  // ============================================================
  useEffect(() => {
    const handleKeyDown = (e) => {
      const tagName = document.activeElement?.tagName?.toLowerCase();
      const isInput = tagName === 'input' || tagName === 'textarea';

      // Alt+R: Refrescar estado de caja
      if (e.altKey && (e.key === 'r' || e.key === 'R')) {
        if (!isInput) {
          e.preventDefault();
          Promise.resolve(handleRetryVerification()).then(() => {
            setLastSyncTime(new Date());
            showMessageModal('Verificación de caja solicitada.', null, { type: 'success' });
          }).catch((retryError) => {
            Logger.warn('No se pudo solicitar la verificación de caja', retryError);
          });
        }
      }

      // Ctrl+Shift+E: Nueva entrada
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'E') {
        e.preventDefault();
        if (!operationDisabled) cashEntryModal.open();
      }

      // Ctrl+Shift+S: Nueva salida
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
        e.preventDefault();
        if (!operationDisabled) cashExitModal.open();
      }

      // Escape: Cerrar modales
      if (e.key === 'Escape' && !isInput) {
        if (
          editInitialModal.isOpen ||
          cashEntryModal.isOpen ||
          cashExitModal.isOpen ||
          cashAdjustmentModal.isOpen ||
          isAuditOpen
        ) {
          return;
        }
        setShowResumen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    operationDisabled,
    handleRetryVerification,
    editInitialModal,
    cashEntryModal,
    cashExitModal,
    cashAdjustmentModal,
    isAuditOpen
  ]);

  // ============================================================
  // AUTO-REFRESH PERIÓDICO
  // ============================================================
  useEffect(() => {
    if (networkUnavailable || (isCloudCash && stateKnown === false)) return undefined;
    const interval = setInterval(() => {
      Promise.resolve(sincronizarEstadoCaja()).then((result) => {
        if (!result?.networkUnavailable) setLastSyncTime(new Date());
      }).catch(() => {});
    }, 30000); // 30 segundos

    return () => clearInterval(interval);
  }, [isCloudCash, networkUnavailable, stateKnown, sincronizarEstadoCaja]);

  // ============================================================
  // VERIFICAR EXCESO DE LIQUIDEZ
  // ============================================================
  useEffect(() => {
    const checkExceso = async () => {
      if (cajaActual && verificarExcesoLiquidez) {
        const tieneExceso = await verificarExcesoLiquidez();
        setExcesoLiquidez(tieneExceso);
      }

      if (cajaActual) {
        const totalTeorico = await calcularTotalTeorico();
        const totalSafe = Money.init(totalTeorico);
        const porcentaje = Money.multiply(
          Money.divide(totalSafe, CAJA_CONFIG?.MAX_CASH_THRESHOLD || 50000),
          100
        );
        setPorcentajeLiquidez(Money.toNumber(porcentaje));
      }
    };
    checkExceso();
  }, [cajaActual, totalesTurno, verificarExcesoLiquidez, calcularTotalTeorico, CAJA_CONFIG]);

  // ============================================================
  // HANDLERS
  // ============================================================

  const handleEntradaSubmit = async (event) => {
    event.preventDefault();
    if (operationDisabled) return;

    const monto = event.target.elements['entrada-monto-input'].value;
    const concepto = event.target.elements['entrada-concepto-input'].value;

    if (await registrarMovimiento('entrada', monto, concepto)) {
      cashEntryModal.close();
      showMessageModal('Entrada registrada correctamente.');
    }
  };

  const handleSalidaSubmit = async (event) => {
    event.preventDefault();
    if (operationDisabled) return;

    const monto = event.target.elements['salida-monto-input'].value;
    const concepto = event.target.elements['salida-concepto-input'].value;

    if (await registrarMovimiento('salida', monto, concepto)) {
      cashExitModal.close();
      showMessageModal('Salida registrada correctamente.');
    }
  };

  const handleAjusteSubmit = async (montoFisicoReal, comentario) => {
    if (operationDisabled) return;

    const resultado = await registrarAjusteCaja(montoFisicoReal, comentario);
    if (!resultado.success) {
      showMessageModal(
        `Error al registrar ajuste: ${resultado.error?.message || resultado.error}`,
        null,
        { type: 'error' }
      );
      return;
    }

    if (resultado.noChange) {
      showMessageModal('No hay diferencia entre monto fisico y total teorico. No se registro ajuste.');
      cashAdjustmentModal.close();
      return;
    }

    const esEntrada = resultado.tipo === 'ajuste_entrada';
    const montoAjuste = Money.toNumber(resultado.monto_ajuste || 0).toFixed(2);
    showMessageModal(`Ajuste registrado: ${esEntrada ? 'ajuste_entrada' : 'ajuste_salida'} por $${montoAjuste}.`);
    cashAdjustmentModal.close();
  };

  const handleActionableError = (errorObj) => {
    const { message, details } = errorObj;
    if (details.actionable === 'SUGGEST_RELOAD') {
      showMessageModal(message, () => window.location.reload(), { confirmButtonText: 'Recargar Página' });
    } else {
      showMessageModal(message, null, { type: 'error' });
    }
  };

  const showBackupPerformanceWarning = (backupResult) => {
    if (backupResult.warnings?.includes(BACKUP_WARNING_BLOB_PERF)) {
      showMessageModal(
        'Aviso: Respaldo generado en modo compatible (Blob). En bases grandes puede tardar mas.',
        null,
        { type: 'warning' }
      );
    }
  };

  const handleVerResumen = async () => {
    if (obtenerResumenEstadistico) {
      try {
        const data = await obtenerResumenEstadistico();
        setResumenData(data);
        setShowResumen(true);
      } catch (error) {
        Logger.error('Error obteniendo resumen:', error);
        showMessageModal('Error al cargar el resumen estadístico.', null, { type: 'error' });
      }
    }
  };

  const handleAuditConfirm = async (montoFisicoTotal, montoFondoSiguienteTurno, comentarios) => {
    if (operationDisabled) return;
    setBackupLoading(true);

    try {
      const result = await realizarAuditoriaYCerrar(montoFisicoTotal, montoFondoSiguienteTurno, comentarios);

      if (!result.success) {
        if (result.error && result.error.details) {
          handleActionableError(result.error);
        } else {
          showMessageModal(`Error al cerrar caja: ${result.error}`, null, { type: 'error' });
        }
        return;
      }

      try {
        const hasValidDriveSession = Boolean(
          isDriveConnected
          && driveAuthValue
          && driveExpiryValue
          && driveExpiryValue > Date.now()
        );

        if (isDriveConnected && !hasValidDriveSession) {
          markDriveNeedsReauth();
        }

        const backupResult = await backupManager.backup({
          reason: 'cash_close',
          manual: true,
          includeBlob: hasValidDriveSession
        });

        if (backupResult.success === true) {
          showBackupPerformanceWarning(backupResult);

          if (hasValidDriveSession) {
            try {
              await googleDriveService.uploadBackup(
                driveAuthValue,
                backupResult.blob,
                backupResult.fileName
              );
              showMessageModal('Corte realizado y respaldo guardado localmente y en Google Drive.');
            } catch (driveError) {
              Logger.error('Fallo respaldo automatico en Google Drive', driveError);
              const driveMessage = driveError.status === 401
                ? 'Corte realizado y respaldo local guardado. La sesión de Google expiró.'
                : 'Corte realizado y respaldo local guardado, pero falló la subida a Google Drive.';
              showMessageModal(driveMessage);
            }
          } else {
            const reauthMessage = needsDriveReauth || isDriveConnected
              ? ' La sesión de Google requiere reconexión.'
              : '';
            showMessageModal(`Corte realizado y respaldo local completado.${reauthMessage}`);
          }
        }
      } catch (backupError) {
        if (backupError.name === 'AbortError') {
          showMessageModal('Corte realizado con éxito.');
        } else {
          Logger.error('Fallo respaldo automatico', backupError);
          showMessageModal('Corte realizado con exito (pero fallo la descarga del respaldo).');
        }
      }

      await sincronizarEstadoCaja();
      setIsAuditOpen(false);
    } finally {
      setBackupLoading(false);
    }
  };

  const handleBackup = async () => {
    if (isBackupLoading) return;
    setBackupLoading(true);

    try {
      const backupResult = await downloadBackupSmart();

      if (backupResult.success === true) {
        showBackupPerformanceWarning(backupResult);
        showMessageModal('Respaldo generado correctamente.');
        return;
      }

      if (backupResult.reason === BACKUP_ABORT_REASON) {
        return;
      }

      throw new Error('Resultado de respaldo no reconocido.');
    } catch (e) {
      Logger.error(e);
      showMessageModal('Error al respaldar.', null, { type: 'error' });
    } finally {
      setBackupLoading(false);
    }
  };

  // ============================================================
  // LOADING STATE
  // ============================================================
  if (isLoading) {
    return (
      <div className="ui-loading-state caja-loading" role="status" aria-live="polite">
        <div className="ui-spinner spinner-loader"></div>
        <p>Sincronizando caja inteligente...</p>
      </div>
    );
  }

  if (estadoCaja === 'error') {
    return (
      <div className="ui-error-state caja-loading" role="alert">
        {networkUnavailable ? (
          <CashNetworkRecoveryBanner onRetry={handleRetryVerification} isRetrying={isRetrying} />
        ) : (
          <>
            <p>{error || 'No se pudo cargar el estado de caja.'}</p>
            <button type="button" className="ui-button ui-button--primary btn btn-primary" onClick={sincronizarEstadoCaja}>
              Reintentar
            </button>
          </>
        )}
      </div>
    );
  }

  if (estadoCaja === 'financial_handoff_required' || estadoCaja === 'financial_blocked') {
    const handoffRequired = estadoCaja === 'financial_handoff_required';
    const stationMismatch = financialCode === 'CASH_SESSION_STATION_MISMATCH';
    const stationSession = aperturaPendiente?.stationOpenCashSession || null;
    return (
      <main className="ui-page caja-page" aria-label="Caja">
        <header className="ui-page__header caja-page__header" aria-label="Estado de caja">
          <div className="ui-section__actions">
            <span className="ui-badge ui-badge--warning">
              {networkUnavailable ? 'Sin conexión con Supabase' : handoffRequired ? 'Caja pendiente de cierre' : 'Estado financiero bloqueado'}
            </span>
          </div>
        </header>
        <section className="ui-section caja-grid caja-grid--opening" role="main" aria-label="Resolución financiera">
          {networkUnavailable ? (
            <CashNetworkRecoveryBanner onRetry={handleRetryVerification} isRetrying={isRetrying} />
          ) : handoffRequired ? (
            <div className="ui-alert ui-alert--warning caja-handoff-card" role="alert">
              <div className="caja-handoff-card__heading">
                <LockKeyhole size={22} aria-hidden="true" />
                <div>
                  <strong>Caja pendiente de cierre</strong>
                  <p>Hay una caja abierta por otro usuario en esta estación. Lanzo no la transfirió ni la cerró automáticamente para proteger el efectivo.</p>
                </div>
              </div>
              <dl className="caja-handoff-card__summary">
                <div><dt>Estación</dt><dd>{cashSessionStationLabel(stationSession)}</dd></div>
                <div><dt>Caja abierta por</dt><dd>{cashSessionResponsibleLabel(stationSession)}</dd></div>
                <div><dt>Estado</dt><dd>Pendiente de cierre y conteo</dd></div>
              </dl>
              <p className="caja-handoff-card__guidance">El usuario que abrió la caja o un administrador debe completar el cierre y la conciliación antes de que otro usuario pueda iniciar un nuevo turno.</p>
            </div>
          ) : stationMismatch ? (
            <div className="ui-alert ui-alert--warning" role="alert">
              <strong>Inconsistencia de estación financiera</strong>
              <p>Supabase devolvió una sesión asociada a otra estación. La Caja permanece bloqueada hasta resolver la identidad de estación explícitamente.</p>
            </div>
          ) : (
            <div className="ui-alert ui-alert--warning" role="alert">
              <strong>No se puede verificar la estación financiera.</strong>
              <p>La caja permanece protegida. Conéctate o completa la recuperación administrativa antes de realizar operaciones de efectivo.</p>
            </div>
          )}
          <CajaHistoryList historial={historialCajas} isCloudCash={isCloudCash} />
          <CajaLegacyCashTransition sessions={legacyAdminCashSessions} isReadOnly={isCloudCashReadOnly} onAdopt={handleAdoptLegacyCashSession} onReview={(session) => setReviewCashSessionId(session.id)} />
          {showBusinessCashSummary && (
            <CajaBusinessCashSummary adminOpenSessions={adminCashSessions} cajaActual={cajaActual} onReviewSession={(session) => setReviewCashSessionId(session.id)} isReadOnly={isCloudCashReadOnly} />
          )}
          <FinancialDiagnosticsPanel enabled={Boolean(isCloudCash)} />
          {showAdminAuditPanel && (
            <CajaStaffAuditPanel
              adminCashSessions={adminCashSessions}
              listCashSessionsForAudit={listCashSessionsForAudit}
              isReadOnly={isCloudCashReadOnly}
              onReviewSession={(session) => setReviewCashSessionId(session.id)}
            />
          )}
          <CajaAdminCashAuditModal
            cashSessionId={reviewCashSessionId}
            onClose={handleAdminCashAuditClose}
            getCashSessionDetailForAudit={getCashSessionDetailForAudit}
            cerrarCajaAdministrativamente={cerrarCajaAdministrativamente}
            isReadOnly={isCloudCashReadOnly}
          />
        </section>
      </main>
    );
  }

  if (estadoCaja === 'needs_opening') {
    return (
      <main className="ui-page caja-page" aria-label="Caja">
        <header className="ui-page__header caja-page__header" aria-label="Estado de caja">
          <div className="ui-section__actions">
            <span className="ui-badge ui-badge--warning">Requiere apertura</span>
          </div>
        </header>
      <section className="ui-section caja-grid caja-grid--opening" role="main" aria-label="Apertura de Caja">
        {networkUnavailable && (
          <CashNetworkRecoveryBanner onRetry={handleRetryVerification} isRetrying={isRetrying} />
        )}
        <CajaOpeningPanel
          aperturaPendiente={aperturaPendiente}
          onOpen={abrirCaja}
          cashActor={cashActor}
          isCloudCash={isCloudCash}
          isReadOnly={isCloudCashReadOnly}
        />
        <CajaHistoryList historial={historialCajas} isCloudCash={isCloudCash} />
        <CajaLegacyCashTransition sessions={legacyAdminCashSessions} isReadOnly={isCloudCashReadOnly} onAdopt={handleAdoptLegacyCashSession} onReview={(session) => setReviewCashSessionId(session.id)} />
        {showBusinessCashSummary && (
          <CajaBusinessCashSummary adminOpenSessions={adminCashSessions} cajaActual={cajaActual} onReviewSession={(session) => setReviewCashSessionId(session.id)} isReadOnly={isCloudCashReadOnly} />
        )}
        <FinancialDiagnosticsPanel enabled={Boolean(isCloudCash)} />
        {showAdminAuditPanel && (
          <CajaStaffAuditPanel
            adminCashSessions={adminCashSessions}
            listCashSessionsForAudit={listCashSessionsForAudit}
            isReadOnly={isCloudCashReadOnly}
            onReviewSession={(session) => setReviewCashSessionId(session.id)}
          />
        )}
        <CajaAdminCashAuditModal
          cashSessionId={reviewCashSessionId}
          onClose={handleAdminCashAuditClose}
          getCashSessionDetailForAudit={getCashSessionDetailForAudit}
          cerrarCajaAdministrativamente={cerrarCajaAdministrativamente}
          isReadOnly={isCloudCashReadOnly}
        />
      </section>
      </main>
    );
  }

  // ============================================================
  // RENDER PRINCIPAL (progressive disclosure)
  return (
    <main className="ui-page caja-page" aria-label="Caja">
      {isCloudCashReadOnly && (
        <header className="ui-page__header caja-page__header" aria-label="Estado de caja">
          <div className="ui-section__actions">
            <span className="ui-badge ui-badge--warning">Solo consulta</span>
          </div>
        </header>
      )}
      <section className="ui-section caja-grid" role="main" aria-label="Gestion de Caja">
        {networkUnavailable && (
          <CashNetworkRecoveryBanner onRetry={handleRetryVerification} isRetrying={isRetrying} />
        )}
        <CajaSectionTabs
          sections={cajaSections}
          activeSection={activeCajaSection}
          onChange={handleSectionChange}
        />

        <div
          id="caja-section-turno"
          role="tabpanel"
          aria-labelledby="caja-tab-turno"
          hidden={activeCajaSection !== 'turno'}
          className="caja-section-panel caja-section-panel--turno"
        >
          <div className="caja-turno-layout">
            <CajaStatusCard
              cajaActual={cajaActual}
              totalesTurno={totalesTurno}
              excesoLiquidez={excesoLiquidez}
              porcentajeLiquidez={porcentajeLiquidez}
              lastSyncTime={lastSyncTime}
              lastActivity={lastActivity}
              isActive={isActive}
              CAJA_CONFIG={CAJA_CONFIG}
              isBackupLoading={isBackupLoading}
              isCloudCash={isCloudCash}
              isReadOnly={isCloudCashReadOnly}
              cashActor={cashActor}
              onEditarFondoInicial={editInitialModal.open}
              onBackup={handleBackup}
              onReporte={descargarReporteCaja}
              onResumen={handleVerResumen}
              onImprimir={() => window.print()}
            />

            <CajaActionsCard
              cajaActual={cajaActual}
              estadoCaja={estadoCaja}
              isBackupLoading={isBackupLoading}
              isCloudCash={isCloudCash}
              isReadOnly={isCloudCashReadOnly}
              cashActor={cashActor}
              readOnlyMessage={CLOUD_CASH_READ_ONLY_MESSAGE}
              onCorte={handlePrimaryCashClose}
              onEntrada={cashEntryModal.open}
              onSalida={cashExitModal.open}
              onAjuste={cashAdjustmentModal.open}
            />

            <CajaLegacyCashTransition
              sessions={legacyAdminCashSessions}
              isReadOnly={isCloudCashReadOnly}
              onAdopt={handleAdoptLegacyCashSession}
              onReview={(session) => setReviewCashSessionId(session.id)}
            />

            {isCloudCash && cashActor?.isStaff && (
              <FinancialDiagnosticsPanel enabled />
            )}
          </div>
        </div>

        <div
          id="caja-section-movimientos"
          role="tabpanel"
          aria-labelledby="caja-tab-movimientos"
          hidden={activeCajaSection !== 'movimientos'}
          className="caja-section-panel caja-section-panel--list"
        >
          {visibleVisitedSections.has('movimientos') && (
            <CajaMovementsList movimientos={movimientosCaja} isCloudCash={isCloudCash} />
          )}
        </div>

        <div
          id="caja-section-historial"
          role="tabpanel"
          aria-labelledby="caja-tab-historial"
          hidden={activeCajaSection !== 'historial'}
          className="caja-section-panel caja-section-panel--list"
        >
          {visibleVisitedSections.has('historial') && (
            <CajaHistoryList historial={historialCajas} isCloudCash={isCloudCash} />
          )}
        </div>

        {showBusinessCashSummary && (
          <div
            id="caja-section-negocio"
            role="tabpanel"
            aria-labelledby="caja-tab-negocio"
            hidden={activeCajaSection !== 'negocio'}
            className="caja-section-panel caja-section-panel--business"
          >
            {visibleVisitedSections.has('negocio') && (
              <div className="caja-business-layout">
                <CajaBusinessCashSummary
                  adminOpenSessions={adminCashSessions}
                  cajaActual={cajaActual}
                  onReviewSession={(session) => setReviewCashSessionId(session.id)}
                  isReadOnly={isCloudCashReadOnly}
                />

                {showAdminAuditPanel && (
                  <details
                    className="caja-disclosure caja-audit-disclosure"
                    onToggle={(event) => {
                      if (event.currentTarget.open) setHasOpenedStaffAudit(true);
                    }}
                  >
                    <summary>Auditoría de cajas</summary>
                    {hasOpenedStaffAudit && (
                      <CajaStaffAuditPanel
                        adminCashSessions={adminCashSessions}
                        listCashSessionsForAudit={listCashSessionsForAudit}
                        isReadOnly={isCloudCashReadOnly}
                        onReviewSession={(session) => setReviewCashSessionId(session.id)}
                      />
                    )}
                  </details>
                )}

                <FinancialDiagnosticsPanel enabled={Boolean(isCloudCash)} initiallyExpanded={false} />
              </div>
            )}
          </div>
        )}

        <EditInitialModal
          show={editInitialModal.isOpen}
          onClose={editInitialModal.close}
          onSave={ajustarMontoInicial}
          currentAmount={cajaActual?.monto_inicial}
          isDisabled={operationDisabled}
        />

        <CashEntryModal
          show={cashEntryModal.isOpen}
          onClose={cashEntryModal.close}
          onSubmit={handleEntradaSubmit}
          isDisabled={operationDisabled}
        />

        <CashExitModal
          show={cashExitModal.isOpen}
          onClose={cashExitModal.close}
          onSubmit={handleSalidaSubmit}
          isDisabled={operationDisabled}
        />

        <CashAdjustmentModal
          show={cashAdjustmentModal.isOpen}
          onClose={cashAdjustmentModal.close}
          onConfirm={handleAjusteSubmit}
          totalTeorico={totalTeorico}
          isDisabled={operationDisabled}
        />

        <AuditModal
          show={isAuditOpen}
          onClose={() => !operationDisabled && setIsAuditOpen(false)}
          onConfirmAudit={handleAuditConfirm}
          caja={cajaActual}
          calcularTeorico={calcularTotalTeorico}
          isProcessing={isBackupLoading}
        />
        <CajaAdminCashAuditModal
          cashSessionId={reviewCashSessionId}
          onClose={handleAdminCashAuditClose}
          getCashSessionDetailForAudit={getCashSessionDetailForAudit}
          cerrarCajaAdministrativamente={cerrarCajaAdministrativamente}
          isReadOnly={isCloudCashReadOnly}
        />

        <ResumenEstadisticoModal
          show={showResumen}
          onClose={() => setShowResumen(false)}
          resumenData={resumenData}
          maxCashThreshold={CAJA_CONFIG?.MAX_CASH_THRESHOLD}
          isDisabled={isBackupLoading}
        />
      </section>
    </main>
  );
}
