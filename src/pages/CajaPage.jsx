// src/pages/CajaPage.jsx
import { useState, useEffect, useMemo } from 'react';
import { useCaja } from '../hooks/useCaja';
import { useModal } from '../hooks/useModal';
import { useRecentActivity } from '../hooks/useRecentActivity';
import AuditModal from '../components/common/AuditModal';
import { showMessageModal } from '../services/utils';
import {
  downloadBackupSmart,
  BACKUP_ABORT_REASON,
  BACKUP_WARNING_BLOB_PERF
} from '../services/dataTransfer';
import { Money } from '../utils/moneyMath';
import { useAppStore } from '../store/useAppStore';
import Logger from '../services/Logger';

// Componentes de secciones
import {
  CajaStatusCard,
  CajaActionsCard,
  CajaMovementsList,
  CajaHistoryList
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
    totalesTurno,
    ajustarMontoInicial,
    realizarAuditoriaYCerrar,
    registrarMovimiento,
    calcularTotalTeorico,
    registrarAjusteCaja,
    sincronizarEstadoCaja,
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

  // ============================================================
  // KEYBOARD SHORTCUTS
  // ============================================================
  useEffect(() => {
    const handleKeyDown = (e) => {
      const tagName = document.activeElement?.tagName?.toLowerCase();
      const isInput = tagName === 'input' || tagName === 'textarea';

      // Ctrl+R: Refrescar estado de caja
      if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
        if (!isInput) {
          e.preventDefault();
          sincronizarEstadoCaja();
          setLastSyncTime(new Date());
          showMessageModal('Estado de caja sincronizado.', null, { type: 'success' });
        }
      }

      // Ctrl+Shift+E: Nueva entrada
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'E') {
        e.preventDefault();
        if (!isBackupLoading) cashEntryModal.open();
      }

      // Ctrl+Shift+S: Nueva salida
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
        e.preventDefault();
        if (!isBackupLoading) cashExitModal.open();
      }

      // Escape: Cerrar modales
      if (e.key === 'Escape' && !isInput) {
        editInitialModal.close();
        cashEntryModal.close();
        cashExitModal.close();
        cashAdjustmentModal.close();
        setIsAuditOpen(false);
        setShowResumen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isBackupLoading, sincronizarEstadoCaja, editInitialModal, cashEntryModal, cashExitModal, cashAdjustmentModal]);

  // ============================================================
  // AUTO-REFRESH PERIÓDICO
  // ============================================================
  useEffect(() => {
    const interval = setInterval(() => {
      sincronizarEstadoCaja();
      setLastSyncTime(new Date());
    }, 30000); // 30 segundos

    return () => clearInterval(interval);
  }, [sincronizarEstadoCaja]);

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
    if (isBackupLoading) return;

    const monto = event.target.elements['entrada-monto-input'].value;
    const concepto = event.target.elements['entrada-concepto-input'].value;

    if (await registrarMovimiento('entrada', monto, concepto)) {
      cashEntryModal.close();
      showMessageModal('Entrada registrada correctamente.');
    }
  };

  const handleSalidaSubmit = async (event) => {
    event.preventDefault();
    if (isBackupLoading) return;

    const monto = event.target.elements['salida-monto-input'].value;
    const concepto = event.target.elements['salida-concepto-input'].value;

    if (await registrarMovimiento('salida', monto, concepto)) {
      cashExitModal.close();
      showMessageModal('Salida registrada correctamente.');
    }
  };

  const handleAjusteSubmit = async (montoFisicoReal, comentario) => {
    if (isBackupLoading) return;

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
    if (isBackupLoading) return;
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
        const backupResult = await downloadBackupSmart();

        if (backupResult.success === true) {
          showBackupPerformanceWarning(backupResult);
          showMessageModal('Corte realizado y respaldo descargado.');
        } else if (backupResult.reason === BACKUP_ABORT_REASON) {
          showMessageModal('Corte realizado con exito.');
        } else {
          throw new Error('Resultado de respaldo no reconocido.');
        }
      } catch (backupError) {
        Logger.error('Fallo respaldo automatico', backupError);
        showMessageModal('Corte realizado con exito (pero fallo la descarga del respaldo).');
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
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div className="spinner-loader"></div>
        <p style={{ marginTop: '10px', color: 'var(--text-light)' }}>
          Sincronizando caja inteligente...
        </p>
      </div>
    );
  }

  // ============================================================
  // RENDER PRINCIPAL (< 50 líneas de JSX)
  // ============================================================
  return (
    <div className="caja-grid" role="main" aria-label="Gestión de Caja">
      {/* 1. TARJETA DE ESTADO */}
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
        onEditarFondoInicial={editInitialModal.open}
        onBackup={handleBackup}
        onReporte={descargarReporteCaja}
        onResumen={handleVerResumen}
        onImprimir={() => window.print()}
      />

      {/* 2. TARJETA DE ACCIONES */}
      <CajaActionsCard
        isBackupLoading={isBackupLoading}
        onCorte={() => setIsAuditOpen(true)}
        onEntrada={cashEntryModal.open}
        onSalida={cashExitModal.open}
        onAjuste={cashAdjustmentModal.open}
      />

      {/* 3. MOVIMIENTOS DEL TURNO (con filtros encapsulados) */}
      <CajaMovementsList movimientos={movimientosCaja} />

      {/* 4. HISTORIAL DE CORTES (con paginación encapsulada) */}
      <CajaHistoryList historial={historialCajas} />

      {/* MODALES */}
      <EditInitialModal
        show={editInitialModal.isOpen}
        onClose={editInitialModal.close}
        onSave={ajustarMontoInicial}
        currentAmount={cajaActual?.monto_inicial}
        isDisabled={isBackupLoading}
      />

      <CashEntryModal
        show={cashEntryModal.isOpen}
        onClose={cashEntryModal.close}
        onSubmit={handleEntradaSubmit}
        isDisabled={isBackupLoading}
      />

      <CashExitModal
        show={cashExitModal.isOpen}
        onClose={cashExitModal.close}
        onSubmit={handleSalidaSubmit}
        isDisabled={isBackupLoading}
      />

      <CashAdjustmentModal
        show={cashAdjustmentModal.isOpen}
        onClose={cashAdjustmentModal.close}
        onConfirm={handleAjusteSubmit}
        totalTeorico={totalTeorico}
        isDisabled={isBackupLoading}
      />

      <AuditModal
        show={isAuditOpen}
        onClose={() => !isBackupLoading && setIsAuditOpen(false)}
        onConfirmAudit={handleAuditConfirm}
        caja={cajaActual}
        calcularTeorico={calcularTotalTeorico}
        isProcessing={isBackupLoading}
      />

      <ResumenEstadisticoModal
        show={showResumen}
        onClose={() => setShowResumen(false)}
        resumenData={resumenData}
        maxCashThreshold={CAJA_CONFIG?.MAX_CASH_THRESHOLD}
        isDisabled={isBackupLoading}
      />
    </div>
  );
}
