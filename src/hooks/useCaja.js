import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { showMessageModal } from '../services/utils';
import Logger from '../services/Logger';
import { Money } from '../utils/moneyMath';
import { MOVIMIENTO_TIPOS, CAJA_CONFIG } from '../services/cajaService';
import { cashRepository } from '../services/cash/cashRepository';
import { CASH_CLOUD_OFFLINE_MESSAGE } from '../services/cash/cashActor';
import {
  CASH_OPENING_POLICY,
  CASH_OPENING_POLICY_EVENT,
  buildAutomaticOpeningData,
  buildManualOpeningData,
  getCashOpeningPolicy
} from '../services/cashOpeningPolicyService.js';

const zeroTotals = { ventasContado: '0', abonosFiado: '0' };
const CACHE_TTL_MS = 5000;

const isOpenCashSession = (cashSession) => cashSession?.estado === 'abierta';

const getNextOpeningSuggestion = (sessions = []) => {
  const lastClosed = sessions.find((cashSession) => cashSession.estado === 'cerrada');
  return lastClosed
    ? (lastClosed.monto_fondo_siguiente_turno ?? lastClosed.monto_cierre ?? '0')
    : '0';
};

const normalizeRepositoryResult = (result = {}) => ({
  cashSession: result.cashSession || result.cash_session || null,
  cashSessions: result.cashSessions || result.cash_sessions || [],
  movements: result.movements || [],
  totals: result.totals || zeroTotals,
  readOnly: Boolean(result.readOnly),
  actor: result.actor || cashRepository.getMode().actor,
  mode: result.mode || cashRepository.getMode(),
  adminOpenSessions: result.adminOpenSessions || result.admin_open_sessions || []
});

export function useCaja() {
  const [cajaActual, setCajaActual] = useState(null);
  const [historialCajas, setHistorialCajas] = useState([]);
  const [movimientosCaja, setMovimientosCaja] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [estadoCaja, setEstadoCaja] = useState('loading');
  const [aperturaPendiente, setAperturaPendiente] = useState(null);
  const [totalesTurno, setTotalesTurno] = useState(zeroTotals);
  const [cashMode, setCashMode] = useState(() => cashRepository.getMode());
  const [cashActor, setCashActor] = useState(() => cashRepository.getMode().actor);
  const [adminCashSessions, setAdminCashSessions] = useState([]);

  const totalesCacheRef = useRef({ teoricoTimestamp: 0, teoricoData: null, teoricoCajaId: null, totalesTurnoKey: null });

  const isCloudCash = cashMode.cloudEnabled;
  const isCloudCashReadOnly = Boolean(cashMode.cloudEnabled && cashMode.readOnly);

  const applyCashState = useCallback((rawResult = {}) => {
    const result = normalizeRepositoryResult(rawResult);
    const current = result.cashSession && isOpenCashSession(result.cashSession) ? result.cashSession : null;
    const history = (result.cashSessions || [])
      .filter(Boolean)
      .filter((cashSession) => !current || cashSession.id !== current.id);

    setCashMode({ ...cashRepository.getMode(), readOnly: result.readOnly });
    setCashActor(result.actor || cashRepository.getMode().actor);
    setAdminCashSessions(result.adminOpenSessions || []);

    if (!current) {
      const suggestedAmount = getNextOpeningSuggestion(history);
      setCajaActual(null);
      setMovimientosCaja([]);
      setTotalesTurno(zeroTotals);
      setAperturaPendiente({
        montoSugerido: Money.toExactString(Money.init(suggestedAmount)),
        ultimaCajaId: history.find((cashSession) => cashSession.estado === 'cerrada')?.id || null,
        motivo: history.length > 0 ? 'previous_close' : 'first_opening',
        readOnly: result.readOnly
      });
      setHistorialCajas(history);
      setEstadoCaja('needs_opening');
      return;
    }

    setCajaActual(current);
    setAperturaPendiente(null);
    setMovimientosCaja(result.movements || []);
    setTotalesTurno(result.totals || zeroTotals);
    setHistorialCajas(history);
    setEstadoCaja('open');
    totalesCacheRef.current = { teoricoTimestamp: 0, teoricoData: null, teoricoCajaId: null, totalesTurnoKey: null };
  }, []);

  const cargarEstadoCaja = useCallback(async ({ showLoading = true } = {}) => {
    if (showLoading) {
      setIsLoading(true);
      setEstadoCaja('loading');
    }
    setError(null);

    try {
      const result = await cashRepository.getCurrentCashSession();
      if (result?.success === false) {
        throw new Error(result.message || 'No se pudo cargar la caja.');
      }
      applyCashState(result);
    } catch (loadError) {
      Logger.error('Error al cargar estado de caja:', loadError);
      setError(loadError.message || 'Error al cargar la caja.');
      setEstadoCaja('error');
    } finally {
      setIsLoading(false);
    }
  }, [applyCashState]);

  useEffect(() => {
    cargarEstadoCaja();
  }, [cargarEstadoCaja]);

  useEffect(() => {
    const refresh = () => cargarEstadoCaja({ showLoading: false });
    window.addEventListener(CASH_OPENING_POLICY_EVENT, refresh);
    window.addEventListener('lanzo:cash-sync-updated', refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(CASH_OPENING_POLICY_EVENT, refresh);
      window.removeEventListener('lanzo:cash-sync-updated', refresh);
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [cargarEstadoCaja]);

  const sincronizarEstadoCaja = useCallback(async () => {
    await cargarEstadoCaja({ showLoading: false });
  }, [cargarEstadoCaja]);

  const ensureMutableCloudCash = useCallback(() => {
    const mode = cashRepository.getMode();
    setCashMode(mode);
    setCashActor(mode.actor);
    if (mode.cloudEnabled && !mode.online) {
      showMessageModal(CASH_CLOUD_OFFLINE_MESSAGE, null, { type: 'warning' });
      return false;
    }
    return true;
  }, []);

  const calcularTotalTeorico = useCallback(async (forceRefresh = false) => {
    if (!cajaActual) return '0';

    const now = Date.now();
    const totalsKey = `${totalesTurno.ventasContado}_${totalesTurno.abonosFiado}_${cajaActual.entradas_efectivo}_${cajaActual.salidas_efectivo}`;

    if (!forceRefresh
      && totalesCacheRef.current.teoricoData
      && totalesCacheRef.current.teoricoCajaId === cajaActual.id
      && totalesCacheRef.current.totalesTurnoKey === totalsKey
      && (now - totalesCacheRef.current.teoricoTimestamp) < CACHE_TTL_MS) {
      return totalesCacheRef.current.teoricoData;
    }

    const inicialSafe = Money.init(cajaActual.monto_inicial || 0);
    const ventasSafe = Money.init(totalesTurno.ventasContado || 0);
    const abonosSafe = Money.init(totalesTurno.abonosFiado || 0);
    const entradasSafe = Money.init(cajaActual.entradas_efectivo || 0);
    const salidasSafe = Money.init(cajaActual.salidas_efectivo || 0);

    const totalSafe = Money.subtract(
      Money.add(Money.add(inicialSafe, ventasSafe), Money.add(abonosSafe, entradasSafe)),
      salidasSafe
    );
    const result = Money.toExactString(totalSafe);

    totalesCacheRef.current = {
      teoricoTimestamp: now,
      teoricoData: result,
      teoricoCajaId: cajaActual.id,
      totalesTurnoKey: totalsKey
    };

    return result;
  }, [cajaActual, totalesTurno]);

  const abrirCaja = useCallback(async (openingInput = {}) => {
    if (!ensureMutableCloudCash()) return false;

    try {
      const mode = cashRepository.getMode();
      const suggestedAmount = aperturaPendiente?.montoSugerido || '0';
      const openingPayload = {
        ...openingInput,
        responsable: mode.actor.isStaff
          ? mode.actor.responsibleName
          : (openingInput.responsable || mode.actor.responsibleName || 'Administrador')
      };

      const openingData = buildManualOpeningData(openingPayload, suggestedAmount);
      const response = await cashRepository.openCashSession(openingData);

      if (response?.success === false) {
        showMessageModal(response.message || 'No se pudo abrir la caja.', null, { type: 'error' });
        await sincronizarEstadoCaja();
        return false;
      }

      await sincronizarEstadoCaja();
      return true;
    } catch (openError) {
      Logger.error('Error abriendo caja:', openError);
      showMessageModal(openError.message || 'No se pudo abrir la caja.', null, { type: 'error' });
      await sincronizarEstadoCaja();
      return false;
    }
  }, [aperturaPendiente, ensureMutableCloudCash, sincronizarEstadoCaja]);

  const asegurarCajaAbierta = useCallback(async () => {
    if (cajaActual && isOpenCashSession(cajaActual)) return cajaActual;

    const mode = cashRepository.getMode();
    if (mode.cloudEnabled) {
      await sincronizarEstadoCaja();
      const errorOpening = new Error(mode.online
        ? 'La caja requiere apertura manual. Confirma el fondo inicial.'
        : CASH_CLOUD_OFFLINE_MESSAGE);
      errorOpening.code = mode.online ? 'CAJA_NEEDS_OPENING' : 'CLOUD_CASH_OFFLINE';
      throw errorOpening;
    }

    if (getCashOpeningPolicy() !== CASH_OPENING_POLICY.AUTOMATIC) {
      await sincronizarEstadoCaja();
      const openingRequiredError = new Error('La caja requiere apertura manual. Confirma el fondo, el conteo y el empleado responsable.');
      openingRequiredError.code = 'CAJA_NEEDS_OPENING';
      throw openingRequiredError;
    }

    const suggestedAmount = aperturaPendiente?.montoSugerido || '0';
    const autoOpening = buildAutomaticOpeningData(suggestedAmount, 'operation_requires_cash');
    const response = await cashRepository.openCashSession(autoOpening);
    await sincronizarEstadoCaja();
    if (response?.success === false) throw new Error(response.message || 'No se pudo abrir caja automaticamente.');
    return response.cashSession || null;
  }, [aperturaPendiente, cajaActual, sincronizarEstadoCaja]);

  const registrarMovimiento = useCallback(async (tipo, monto, concepto) => {
    if (!cajaActual) {
      showMessageModal('Error: No hay caja activa para registrar movimientos.');
      return false;
    }
    if (!ensureMutableCloudCash()) return false;

    const tiposPermitidos = Object.values(MOVIMIENTO_TIPOS);
    if (!tiposPermitidos.includes(tipo)) {
      showMessageModal('Tipo de movimiento no permitido.');
      return false;
    }

    const montoSafe = Money.init(monto);
    if (montoSafe.lte(0)) {
      showMessageModal('El monto debe ser mayor a 0.');
      return false;
    }

    const conceptoLimpio = String(concepto || '').trim();
    if (!conceptoLimpio) {
      showMessageModal('El concepto es obligatorio.');
      return false;
    }

    if (!cashRepository.getMode().cloudEnabled) {
      const isExit = tipo === MOVIMIENTO_TIPOS.SALIDA || tipo === MOVIMIENTO_TIPOS.AJUSTE_SALIDA;
      if (isExit) {
        const totalActualSafe = Money.init(await calcularTotalTeorico(true));
        const postExitSafe = Money.subtract(totalActualSafe, montoSafe);
        if (postExitSafe.lt(0)) {
          showMessageModal(`⚠️ Operación bloqueada: La salida dejaría la caja en $${Money.toNumber(postExitSafe).toFixed(2)}. No hay fondos suficientes.`);
          return false;
        }
      }
    }

    try {
      const response = await cashRepository.registerMovement({
        cashSessionId: cajaActual.id,
        type: tipo,
        amount: Money.toExactString(montoSafe),
        concept: conceptoLimpio
      });

      if (response?.success === false) {
        showMessageModal(response.message || 'Error al registrar el movimiento de caja.', null, { type: 'error' });
        await sincronizarEstadoCaja();
        return false;
      }

      await sincronizarEstadoCaja();
      return true;
    } catch (movementError) {
      Logger.error('Error registrando movimiento de caja', movementError);
      showMessageModal(movementError.message || 'Error al registrar el movimiento de caja.', null, { type: 'error' });
      await sincronizarEstadoCaja();
      return false;
    }
  }, [cajaActual, calcularTotalTeorico, ensureMutableCloudCash, sincronizarEstadoCaja]);

  const ajustarMontoInicial = useCallback(async (nuevoMonto, motivo = '') => {
    if (!cajaActual) return false;
    if (!ensureMutableCloudCash()) return false;

    const motivoLimpio = String(motivo || '').trim();
    if (!motivoLimpio) {
      showMessageModal('Error: Indica el motivo del ajuste de fondo inicial.');
      return false;
    }

    try {
      const response = await cashRepository.adjustInitialFund({
        cashSessionId: cajaActual.id,
        newAmount: nuevoMonto,
        reason: motivoLimpio,
        expectedVersion: cajaActual.serverVersion || null
      });

      if (response?.success === false) {
        showMessageModal(response.message || 'No se pudo ajustar el fondo inicial.', null, { type: 'error' });
        return false;
      }

      showMessageModal(response.noChange ? 'El fondo inicial ya tenia ese monto.' : 'Fondo inicial ajustado.');
      await sincronizarEstadoCaja();
      return true;
    } catch (adjustError) {
      Logger.error('Error ajustando monto inicial', adjustError);
      showMessageModal(adjustError.message || 'No se pudo ajustar el fondo inicial.', null, { type: 'error' });
      await sincronizarEstadoCaja();
      return false;
    }
  }, [cajaActual, ensureMutableCloudCash, sincronizarEstadoCaja]);

  const realizarAuditoriaYCerrar = useCallback(async (montoFisicoTotal, montoFondoSiguienteTurno, comentarios = '') => {
    if (!cajaActual) return { success: false, error: new Error('No hay caja activa.') };
    if (!ensureMutableCloudCash()) return { success: false, error: new Error(CASH_CLOUD_OFFLINE_MESSAGE) };

    try {
      const montoFisicoSafe = Money.init(montoFisicoTotal);
      const fondoSiguienteSafe = Money.init(montoFondoSiguienteTurno);

      if (montoFisicoSafe.lt(0) || fondoSiguienteSafe.lt(0)) {
        return { success: false, error: new Error('Los montos de auditoria no pueden ser negativos.') };
      }
      if (fondoSiguienteSafe.gt(montoFisicoSafe)) {
        return { success: false, error: new Error('El fondo del siguiente turno no puede ser mayor al dinero fisico contado.') };
      }

      const response = await cashRepository.closeCashSession({
        cashSessionId: cajaActual.id,
        countedAmount: Money.toExactString(montoFisicoSafe),
        nextShiftFund: Money.toExactString(fondoSiguienteSafe),
        comments: comentarios,
        expectedVersion: cajaActual.serverVersion || null
      });

      if (response?.success === false) {
        return { success: false, error: new Error(response.message || 'No se pudo cerrar caja.') };
      }

      const diferencia = response.diferencia || response.cashSession?.diferencia || '0';
      const mode = cashRepository.getMode();

      if (!mode.cloudEnabled && getCashOpeningPolicy() === CASH_OPENING_POLICY.AUTOMATIC) {
        try {
          const opening = buildAutomaticOpeningData(Money.toExactString(fondoSiguienteSafe), 'cash_close');
          await cashRepository.openCashSession(opening);
        } catch (autoOpenError) {
          Logger.error('La caja se cerro, pero fallo la autoapertura configurada', autoOpenError);
        }
      }

      await sincronizarEstadoCaja();
      return { success: true, diferencia };
    } catch (auditError) {
      Logger.error('Error en cierre de caja', auditError);
      return { success: false, error: auditError };
    }
  }, [cajaActual, ensureMutableCloudCash, sincronizarEstadoCaja]);

  const registrarAjusteCaja = useCallback(async (montoFisicoReal, comentario) => {
    if (!cajaActual) return { success: false, error: new Error('No hay caja activa para ajustar.') };

    const comentarioLimpio = String(comentario || '').trim();
    if (!comentarioLimpio) {
      showMessageModal('El comentario es obligatorio para registrar ajustes.');
      return { success: false, error: new Error('Comentario obligatorio.') };
    }

    try {
      const montoFisicoRealSafe = Money.init(montoFisicoReal);
      if (montoFisicoRealSafe.lt(0)) {
        showMessageModal('El monto fisico no puede ser negativo.');
        return { success: false, error: new Error('Monto fisico invalido.') };
      }

      const totalTeoricoSafe = Money.init(await calcularTotalTeorico(true));
      const diferenciaSafe = Money.subtract(montoFisicoRealSafe, totalTeoricoSafe);
      if (diferenciaSafe.eq(0)) {
        return { success: true, noChange: true, diferencia: Money.toExactString(diferenciaSafe) };
      }

      const tipoAjuste = diferenciaSafe.gt(0) ? MOVIMIENTO_TIPOS.AJUSTE_ENTRADA : MOVIMIENTO_TIPOS.AJUSTE_SALIDA;
      const montoAjusteSafe = diferenciaSafe.gt(0) ? diferenciaSafe : diferenciaSafe.abs();
      const registrado = await registrarMovimiento(tipoAjuste, Money.toExactString(montoAjusteSafe), comentarioLimpio);

      if (!registrado) return { success: false, error: new Error('No se pudo registrar el ajuste en caja.') };

      return {
        success: true,
        noChange: false,
        tipo: tipoAjuste,
        diferencia: Money.toExactString(diferenciaSafe),
        monto_ajuste: Money.toExactString(montoAjusteSafe)
      };
    } catch (adjustError) {
      Logger.error('Error registrando ajuste de caja', adjustError);
      return { success: false, error: adjustError };
    }
  }, [cajaActual, calcularTotalTeorico, registrarMovimiento]);

  const obtenerResumenEstadistico = useCallback(async () => {
    if (!cajaActual) return null;

    const totalTeorico = Money.init(await calcularTotalTeorico());
    const elapsedMs = Date.now() - new Date(cajaActual.fecha_apertura).getTime();
    const elapsedHours = Math.max(elapsedMs / (1000 * 60 * 60), 0.01);
    const totalIngresos = Money.add(
      Money.init(cajaActual.monto_inicial || 0),
      Money.add(
        Money.init(totalesTurno.ventasContado || 0),
        Money.add(Money.init(totalesTurno.abonosFiado || 0), Money.init(cajaActual.entradas_efectivo || 0))
      )
    );
    const totalSalidas = Money.init(cajaActual.salidas_efectivo || 0);

    return {
      fechaApertura: cajaActual.fecha_apertura,
      tiempoTranscurrido: {
        milisegundos: elapsedMs,
        horas: (elapsedMs / (1000 * 60 * 60)).toFixed(2),
        minutos: Math.floor(elapsedMs / (1000 * 60))
      },
      totalTeorico: Money.toExactString(totalTeorico),
      totalIngresos: Money.toExactString(totalIngresos),
      totalSalidas: Money.toExactString(totalSalidas),
      flujoNeto: Money.toExactString(Money.subtract(totalIngresos, totalSalidas)),
      fondoInicial: cajaActual.monto_inicial || '0',
      ventasContado: totalesTurno.ventasContado || '0',
      abonosFiado: totalesTurno.abonosFiado || '0',
      entradasExtras: cajaActual.entradas_efectivo || '0',
      ventasPorHora: Money.toExactString(Money.divide(Money.init(totalesTurno.ventasContado || 0), elapsedHours)),
      ticketPromedioEstimado: Money.toExactString(Money.divide(Money.init(totalesTurno.ventasContado || 0), Math.max(movimientosCaja.length, 1))),
      totalMovimientos: movimientosCaja.length,
      movimientosEntrada: movimientosCaja.filter((m) => ['entrada', 'ajuste_entrada'].includes(m.tipo)).length,
      movimientosSalida: movimientosCaja.filter((m) => ['salida', 'ajuste_salida'].includes(m.tipo)).length,
      alertas: {
        excesoLiquidez: totalTeorico.gt(CAJA_CONFIG.MAX_CASH_THRESHOLD),
        salidasSignificativas: Money.init(cajaActual.salidas_efectivo || 0).gt(Money.multiply(totalIngresos, 0.3))
      }
    };
  }, [cajaActual, calcularTotalTeorico, movimientosCaja, totalesTurno]);

  const exportarReporteCajaCSV = useCallback(async () => {
    if (!cajaActual) return { success: false, error: 'No hay caja activa para exportar' };

    try {
      const resumen = await obtenerResumenEstadistico();
      const fechaCorte = new Date().toISOString().split('T')[0];
      const headers = ['Concepto', 'Valor', 'Tipo', 'Notas'];
      const rows = [
        ['Fecha Apertura', new Date(cajaActual.fecha_apertura).toLocaleString(), 'info', ''],
        ['Responsable', cajaActual.responsable_apertura || cajaActual.responsibleName || '', 'info', ''],
        ['Estado', cajaActual.estado, 'info', ''],
        ['Total Teórico Caja', `$${Money.toNumber(resumen.totalTeorico).toFixed(2)}`, 'total', ''],
        ['Fondo Inicial', `$${Money.toNumber(resumen.fondoInicial).toFixed(2)}`, 'ingreso', ''],
        ['Ventas (Contado)', `$${Money.toNumber(resumen.ventasContado).toFixed(2)}`, 'ingreso', ''],
        ['Abonos (Fiado)', `$${Money.toNumber(resumen.abonosFiado).toFixed(2)}`, 'ingreso', ''],
        ['Entradas Extras', `$${Money.toNumber(resumen.entradasExtras).toFixed(2)}`, 'ingreso', ''],
        ['Salidas', `$${Money.toNumber(resumen.totalSalidas).toFixed(2)}`, 'egreso', ''],
        ...movimientosCaja.map((mov) => [
          `Movimiento: ${mov.concepto}`,
          `$${Money.toNumber(mov.monto).toFixed(2)}`,
          mov.tipo,
          new Date(mov.fecha).toLocaleString()
        ])
      ];
      const csvContent = [headers.join(','), ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))].join('\n');
      const blob = new Blob([`\ufeff${csvContent}`], { type: 'text/csv;charset=utf-8;' });
      return { success: true, blob, filename: `reporte_caja_${fechaCorte}_${cajaActual.id.slice(-6)}.csv` };
    } catch (exportError) {
      Logger.error('Error exportando reporte de caja', exportError);
      return { success: false, error: exportError.message };
    }
  }, [cajaActual, movimientosCaja, obtenerResumenEstadistico]);

  const descargarReporteCaja = useCallback(async () => {
    const resultado = await exportarReporteCajaCSV();
    if (!resultado.success) {
      showMessageModal(`Error al exportar: ${resultado.error}`, null, { type: 'error' });
      return;
    }
    const url = URL.createObjectURL(resultado.blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', resultado.filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showMessageModal('Reporte de caja exportado correctamente.');
  }, [exportarReporteCajaCSV]);

  const verificarExcesoLiquidez = useCallback(async () => {
    if (!cajaActual) return false;
    const totalTeorico = Money.init(await calcularTotalTeorico());
    return totalTeorico.gt(CAJA_CONFIG.MAX_CASH_THRESHOLD);
  }, [cajaActual, calcularTotalTeorico]);

  const listCashSessionsForAudit = useCallback((filters = {}) => cashRepository.listCashSessionsForAudit(filters), []);

  const modeSnapshot = useMemo(() => ({
    cashMode,
    isCloudCash,
    isCloudCashReadOnly,
    cashActor,
    adminCashSessions
  }), [adminCashSessions, cashActor, cashMode, isCloudCash, isCloudCashReadOnly]);

  return {
    cajaActual,
    historialCajas,
    movimientosCaja,
    error,
    isLoading,
    estadoCaja,
    aperturaPendiente,
    totalesTurno,
    ajustarMontoInicial,
    abrirCaja,
    asegurarCajaAbierta,
    realizarAuditoriaYCerrar,
    registrarMovimiento,
    calcularTotalTeorico,
    registrarAjusteCaja,
    sincronizarEstadoCaja,
    obtenerResumenEstadistico,
    exportarReporteCajaCSV,
    descargarReporteCaja,
    verificarExcesoLiquidez,
    listCashSessionsForAudit,
    ...modeSnapshot,
    CAJA_CONFIG
  };
}
