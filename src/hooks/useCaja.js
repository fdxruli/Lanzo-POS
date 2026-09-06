import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { showConfirmModal, showMessageModal } from '../services/utils';
import Logger from '../services/Logger';
import { Money } from '../utils/moneyMath';
import { MOVIMIENTO_TIPOS, CAJA_CONFIG } from '../services/cajaService';
import { cashRepository } from '../services/cash/cashRepository';
import { CASH_CLOUD_OFFLINE_MESSAGE } from '../services/cash/cashActor';
import {
  CASH_NETWORK_UNAVAILABLE_CODE,
  CASH_NETWORK_UNAVAILABLE_MESSAGE,
  isCashNetworkUnavailableError
} from '../services/cash/cashNetwork';
import { areCashStationsEquivalent } from '../services/cash/cashStation';
import { resolveCashSessionAmounts } from '../services/cajaProjection';
import { useAppStore } from '../store/useAppStore';
import {
  CASH_OPENING_POLICY,
  CASH_OPENING_POLICY_EVENT,
  buildAutomaticOpeningData,
  buildManualOpeningData,
  getCashOpeningPolicy,
  setCashOpeningPolicy as persistCashOpeningPolicy
} from '../services/cashOpeningPolicyService.js';

const zeroTotals = { ventasContado: '0', abonosFiado: '0' };
const CACHE_TTL_MS = 5000;

const isOpenCashSession = (cashSession) => (
  cashSession?.estado === 'abierta' || cashSession?.status === 'open'
);

const getSessionStationId = (cashSession) => (
  cashSession?.cashStationId || cashSession?.cash_station_id || null
);

const getSessionActorKey = (cashSession) => cashSession?.actorKey || cashSession?.actor_key || null;

const isSessionForStation = (cashSession, cashStationId, actorKey = null) => (
  Boolean(
    isOpenCashSession(cashSession)
    && cashStationId
    && getSessionStationId(cashSession)
    && areCashStationsEquivalent(getSessionStationId(cashSession), cashStationId)
    && (!actorKey || getSessionActorKey(cashSession) === actorKey)
  )
);

const createCajaNeedsOpeningError = (message = 'La caja requiere apertura manual. Confirma el fondo inicial.') => {
  const error = new Error(message);
  error.code = 'CAJA_NEEDS_OPENING';
  return error;
};

const createCloudCashOfflineError = ({ networkUnavailable = false } = {}) => {
  const error = new Error(networkUnavailable ? CASH_NETWORK_UNAVAILABLE_MESSAGE : CASH_CLOUD_OFFLINE_MESSAGE);
  error.code = networkUnavailable ? CASH_NETWORK_UNAVAILABLE_CODE : 'CLOUD_CASH_OFFLINE';
  return error;
};

const createCashFinancialGateError = (code, message) => {
  const error = new Error(message || code);
  error.code = code;
  return error;
};

const switchCashOpeningToManual = () => {
  const storeSetter = useAppStore.getState?.().setCashOpeningPolicy;
  if (typeof storeSetter === 'function') {
    storeSetter(CASH_OPENING_POLICY.MANUAL);
    return;
  }

  persistCashOpeningPolicy(CASH_OPENING_POLICY.MANUAL);
};

const getNextOpeningSuggestion = (sessions = []) => {
  const lastClosed = sessions.filter(Boolean).find((cashSession) => cashSession.estado === 'cerrada');
  return lastClosed
    ? (lastClosed.monto_fondo_siguiente_turno ?? lastClosed.monto_cierre ?? '0')
    : '0';
};

const normalizeRepositoryResult = (result = {}) => {
  const mode = result.mode || cashRepository.getMode();
  const financialState = result.financialState || result.financial_state || null;
  const networkUnavailable = Boolean(
    result.networkUnavailable
    || financialState?.networkUnavailable
    || result.financialCode === CASH_NETWORK_UNAVAILABLE_CODE
    || financialState?.code === CASH_NETWORK_UNAVAILABLE_CODE
  );
  const stateKnown = result.stateKnown !== false && financialState?.stateKnown !== false;

  return {
    cashSession: result.cashSession || result.cash_session || null,
    cashSessions: Array.isArray(result.cashSessions || result.cash_sessions)
      ? (result.cashSessions || result.cash_sessions).filter(Boolean)
      : [],
    movements: Array.isArray(result.movements) ? result.movements.filter(Boolean) : [],
    totals: result.totals || zeroTotals,
    readOnly: Boolean(result.readOnly || (mode.cloudEnabled && (!stateKnown || networkUnavailable))),
    stateKnown,
    networkUnavailable,
    actor: result.actor || mode.actor,
    mode,
    financialStatus: result.financialStatus || financialState?.status || null,
    financialCode: result.financialCode || financialState?.code || null,
    financialState,
    cashStationId: result.cashStationId || result.cash_station_id || null,
    stationOpenCashSession: result.stationOpenCashSession || result.station_open_cash_session || null,
    adminOpenSessions: Array.isArray(result.adminOpenSessions || result.admin_open_sessions)
      ? (result.adminOpenSessions || result.admin_open_sessions).filter(Boolean)
      : [],
    legacyAdminCashSessions: Array.isArray(result.legacyAdminCashSessions || result.legacy_admin_cash_sessions)
      ? (result.legacyAdminCashSessions || result.legacy_admin_cash_sessions).filter(Boolean)
      : []
  };
};

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
  const [legacyAdminCashSessions, setLegacyAdminCashSessions] = useState([]);
  const [isRetrying, setIsRetrying] = useState(false);

  const totalesCacheRef = useRef({ teoricoTimestamp: 0, teoricoData: null, teoricoCajaId: null, totalesTurnoKey: null });
  const verificationInFlightRef = useRef(null);
  const pendingForceVerificationRef = useRef(false);
  const verificationSequenceRef = useRef(0);
  const lastAppliedSequenceRef = useRef(0);
  const lastSuccessfulSequenceRef = useRef(0);
  const mountedRef = useRef(true);
  const networkUnavailableRef = useRef(Boolean(cashMode.networkUnavailable));
  const lastCashStateRef = useRef({
    cashSession: null,
    cashSessions: [],
    movements: [],
    totals: zeroTotals,
    cashStationId: null,
    stationOpenCashSession: null,
    actor: cashActor,
    mode: cashMode,
    financialState: null
  });

  const isCloudCash = cashMode.cloudEnabled;
  const isCloudCashReadOnly = Boolean(
    cashMode.cloudEnabled
    && (cashMode.readOnly || cashMode.stateKnown === false || cashMode.networkUnavailable)
  );

  const applyCashState = useCallback((rawResult = {}) => {
    if (!mountedRef.current) return;

    const result = normalizeRepositoryResult(rawResult);
    const previous = lastCashStateRef.current;
    const isNetworkUnavailable = result.networkUnavailable;
    const displayResult = isNetworkUnavailable
      ? {
        ...result,
        cashSession: result.cashSession || previous.cashSession,
        cashSessions: result.cashSessions.length > 0 ? result.cashSessions : previous.cashSessions,
        movements: result.movements.length > 0 || !previous.movements.length
          ? result.movements
          : previous.movements,
        totals: result.totals || previous.totals,
        cashStationId: result.cashStationId || previous.cashStationId,
        stationOpenCashSession: result.stationOpenCashSession || previous.stationOpenCashSession,
        actor: result.actor || previous.actor,
        mode: result.mode || previous.mode
      }
      : result;
    const current = isSessionForStation(
      displayResult.cashSession,
      displayResult.cashStationId,
      displayResult.actor?.actorKey
    )
      ? displayResult.cashSession
      : null;
    const candidateSessionMismatch = Boolean(displayResult.cashSession && !current);
    const history = (displayResult.cashSessions || [])
      .filter(Boolean)
      .filter((cashSession) => !current || cashSession.id !== current.id);
    const currentMode = cashRepository.getMode();
    const nextReadOnly = Boolean(
      displayResult.readOnly
      || (currentMode.cloudEnabled && candidateSessionMismatch)
      || (currentMode.cloudEnabled && (!displayResult.stateKnown || displayResult.networkUnavailable))
    );
    const financialStatus = candidateSessionMismatch ? 'BLOCKED' : displayResult.financialStatus;
    const nextMode = {
      ...currentMode,
      ...(displayResult.mode || {}),
      readOnly: nextReadOnly,
      stateKnown: displayResult.stateKnown,
      networkUnavailable: displayResult.networkUnavailable
    };

    networkUnavailableRef.current = displayResult.networkUnavailable;
    lastCashStateRef.current = {
      cashSession: displayResult.cashSession,
      cashSessions: history,
      movements: displayResult.movements || [],
      totals: displayResult.totals || zeroTotals,
      cashStationId: displayResult.cashStationId,
      stationOpenCashSession: displayResult.stationOpenCashSession,
      actor: displayResult.actor || currentMode.actor,
      mode: nextMode,
      financialState: displayResult.financialState
    };

    setCashMode(nextMode);
    setCashActor(displayResult.actor || currentMode.actor);
    setAdminCashSessions(displayResult.adminOpenSessions || []);
    setLegacyAdminCashSessions(displayResult.legacyAdminCashSessions || []);

    if (!current) {
      const suggestedAmount = getNextOpeningSuggestion(history);
      setCajaActual(null);
      setMovimientosCaja([]);
      setTotalesTurno(zeroTotals);
      setAperturaPendiente({
        montoSugerido: Money.toExactString(Money.init(suggestedAmount)),
        ultimaCajaId: history.find((cashSession) => cashSession.estado === 'cerrada')?.id || null,
        motivo: history.length > 0 ? 'previous_close' : 'first_opening',
        readOnly: nextReadOnly,
        financialStatus,
        financialCode: displayResult.financialCode,
        stationOpenCashSession: displayResult.stationOpenCashSession
      });
      setHistorialCajas(history);
      setEstadoCaja(
        displayResult.networkUnavailable || financialStatus === 'BLOCKED'
          ? 'financial_blocked'
          : financialStatus === 'HANDOFF_REQUIRED'
          ? 'financial_handoff_required'
          : 'needs_opening'
      );
      return;
    }

    setCajaActual(current);
    setAperturaPendiente(null);
    setMovimientosCaja(displayResult.movements || []);
    setTotalesTurno(displayResult.totals || zeroTotals);
    setHistorialCajas(history);
    setEstadoCaja('open');
    totalesCacheRef.current = { teoricoTimestamp: 0, teoricoData: null, teoricoCajaId: null, totalesTurnoKey: null };
  }, []);

  const buildNetworkFallbackResult = useCallback(() => {
    const mode = cashRepository.getMode();
    const previous = lastCashStateRef.current;
    return {
      success: true,
      cashSession: previous.cashSession,
      cashSessions: previous.cashSessions,
      movements: previous.movements,
      totals: previous.totals,
      cashStationId: previous.cashStationId,
      stationOpenCashSession: previous.stationOpenCashSession,
      actor: previous.actor || mode.actor,
      mode,
      readOnly: true,
      stateKnown: false,
      networkUnavailable: true,
      financialStatus: 'BLOCKED',
      financialCode: CASH_NETWORK_UNAVAILABLE_CODE,
      financialState: {
        ...(previous.financialState || {}),
        status: 'BLOCKED',
        code: CASH_NETWORK_UNAVAILABLE_CODE,
        stateKnown: false,
        networkUnavailable: true
      },
      warning: CASH_NETWORK_UNAVAILABLE_MESSAGE
    };
  }, []);

  const cargarEstadoCaja = useCallback(({ showLoading = true, force = false } = {}) => {
    if (verificationInFlightRef.current) {
      if (force) pendingForceVerificationRef.current = true;
      return verificationInFlightRef.current;
    }

    if (showLoading) {
      setIsLoading(true);
      setEstadoCaja('loading');
    }
    setError(null);

    const sequence = verificationSequenceRef.current + 1;
    verificationSequenceRef.current = sequence;
    const request = (async () => {
      try {
        const result = await cashRepository.getCurrentCashSession({ force });
        if (result?.success === false) {
          const loadError = new Error(result.message || 'No se pudo cargar la caja.');
          loadError.code = result.code;
          throw loadError;
        }

        const normalized = normalizeRepositoryResult(result);
        const isStale = sequence < lastAppliedSequenceRef.current
          || (normalized.networkUnavailable && lastSuccessfulSequenceRef.current > sequence);
        if (!isStale) {
          lastAppliedSequenceRef.current = sequence;
          applyCashState(result);
          if (!normalized.networkUnavailable && normalized.stateKnown) {
            lastSuccessfulSequenceRef.current = sequence;
          }
        }
        return result;
      } catch (loadError) {
        if (isCashNetworkUnavailableError(loadError)) {
          const networkResult = buildNetworkFallbackResult();
          if (sequence >= lastAppliedSequenceRef.current
            && lastSuccessfulSequenceRef.current <= sequence) {
            lastAppliedSequenceRef.current = sequence;
            applyCashState(networkResult);
          }
          return networkResult;
        }

        if (sequence >= lastAppliedSequenceRef.current) {
          Logger.error('Error al cargar estado de caja:', loadError);
          setError(loadError.message || 'Error al cargar la caja.');
          setEstadoCaja('error');
        }
        return null;
      } finally {
        if (mountedRef.current) setIsLoading(false);
      }
    })();

    verificationInFlightRef.current = request;
    const settleVerification = () => {
      if (verificationInFlightRef.current === request) verificationInFlightRef.current = null;
      const shouldForceRetry = pendingForceVerificationRef.current;
      pendingForceVerificationRef.current = false;
      if (!mountedRef.current) return;
      if (shouldForceRetry) {
        setIsRetrying(true);
        window.setTimeout(() => {
          if (mountedRef.current) cargarEstadoCaja({ showLoading: false, force: true });
        }, 0);
      } else {
        setIsRetrying(false);
      }
    };
    request.then(settleVerification, settleVerification);
    return request;
  }, [applyCashState, buildNetworkFallbackResult]);

  useEffect(() => {
    cargarEstadoCaja();
  }, [cargarEstadoCaja]);

  useEffect(() => {
    let refreshTimer = null;
    const scheduleRefresh = ({ allowWhenUnavailable = false } = {}) => {
      if (refreshTimer || (networkUnavailableRef.current && !allowWhenUnavailable)) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        cargarEstadoCaja({ showLoading: false });
      }, 0);
    };
    const refreshOnline = () => {
      if (refreshTimer) {
        window.clearTimeout(refreshTimer);
        refreshTimer = null;
      }
      cargarEstadoCaja({ showLoading: false, force: true });
    };
    const refreshOffline = () => {
      if (!cashRepository.getMode().cloudEnabled) {
        networkUnavailableRef.current = false;
        scheduleRefresh({ allowWhenUnavailable: true });
        return;
      }
      networkUnavailableRef.current = true;
      const offlineSequence = verificationSequenceRef.current + 1;
      verificationSequenceRef.current = offlineSequence;
      lastAppliedSequenceRef.current = offlineSequence;
      applyCashState(buildNetworkFallbackResult());
      scheduleRefresh({ allowWhenUnavailable: true });
    };
    const refresh = () => scheduleRefresh();
    window.addEventListener(CASH_OPENING_POLICY_EVENT, refresh);
    window.addEventListener('lanzo:cash-sync-updated', refresh);
    window.addEventListener('online', refreshOnline);
    window.addEventListener('offline', refreshOffline);
    window.addEventListener('storage', refresh);
    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      window.removeEventListener(CASH_OPENING_POLICY_EVENT, refresh);
      window.removeEventListener('lanzo:cash-sync-updated', refresh);
      window.removeEventListener('online', refreshOnline);
      window.removeEventListener('offline', refreshOffline);
      window.removeEventListener('storage', refresh);
    };
  }, [applyCashState, buildNetworkFallbackResult, cargarEstadoCaja]);

  const sincronizarEstadoCaja = useCallback(async ({ force = false } = {}) => (
    cargarEstadoCaja({ showLoading: false, force })
  ), [cargarEstadoCaja]);

  const reintentarVerificacion = useCallback(() => {
    setIsRetrying(true);
    return cargarEstadoCaja({ showLoading: false, force: true });
  }, [cargarEstadoCaja]);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const ensureMutableCloudCash = useCallback(() => {
    const mode = cashRepository.getMode();
    setCashActor(mode.actor);
    const verificationUnknown = mode.cloudEnabled && (
      !mode.online
      || cashMode.readOnly
      || cashMode.stateKnown === false
      || cashMode.networkUnavailable
    );
    if (verificationUnknown) {
      showMessageModal(
        !mode.online || cashMode.networkUnavailable
          ? CASH_NETWORK_UNAVAILABLE_MESSAGE
          : CASH_CLOUD_OFFLINE_MESSAGE,
        null,
        { type: 'warning' }
      );
      return false;
    }
    return true;
  }, [cashMode]);

  const calcularTotalTeorico = useCallback(async (forceRefresh = false) => {
    if (!cajaActual) return '0';

    const now = Date.now();
    const totalsKey = [
      totalesTurno.ventasContado,
      totalesTurno.abonosFiado,
      cajaActual.ventas_efectivo,
      cajaActual.abonos_fiado,
      cajaActual.entradas_efectivo,
      cajaActual.salidas_efectivo,
      cajaActual.total_teorico_cloud
    ].join('_');

    if (!forceRefresh
      && totalesCacheRef.current.teoricoData
      && totalesCacheRef.current.teoricoCajaId === cajaActual.id
      && totalesCacheRef.current.totalesTurnoKey === totalsKey
      && (now - totalesCacheRef.current.teoricoTimestamp) < CACHE_TTL_MS) {
      return totalesCacheRef.current.teoricoData;
    }

    // En cloud, Supabase es la fuente oficial de totales de caja.
    const result = resolveCashSessionAmounts(cajaActual, totalesTurno, { isCloudCash }).totalTeorico;

    totalesCacheRef.current = {
      teoricoTimestamp: now,
      teoricoData: result,
      teoricoCajaId: cajaActual.id,
      totalesTurnoKey: totalsKey
    };

    return result;
  }, [cajaActual, isCloudCash, totalesTurno]);

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
    const mode = cashRepository.getMode();
    setCashMode(mode);
    setCashActor(mode.actor);

    if (mode.cloudEnabled) {
      if (!mode.online) {
        throw createCloudCashOfflineError();
      }

      const result = await cashRepository.getCurrentCashSession({ force: true });

      if (result?.success === false) {
        const error = new Error(result.message || 'No se pudo verificar la caja cloud.');
        error.code = result.code || 'CASH_CURRENT_FAILED';
        throw error;
      }

      if (result?.networkUnavailable || result?.stateKnown === false) {
        throw createCloudCashOfflineError({ networkUnavailable: Boolean(result.networkUnavailable) });
      }

      if (result?.readOnly) {
        throw createCloudCashOfflineError();
      }

      if (result?.financialStatus === 'HANDOFF_REQUIRED' || result?.financialCode === 'CASH_HANDOFF_REQUIRED') {
        throw createCashFinancialGateError(
          'CASH_HANDOFF_REQUIRED',
          'La caja anterior sigue abierta. Requiere cierre y reconciliación explícitos antes de cobrar.'
        );
      }
      if (result?.financialStatus === 'BLOCKED' || result?.financialCode === 'CASH_HANDOFF_REQUIRES_ONLINE') {
        throw createCashFinancialGateError(
          result.financialCode || 'CASH_HANDOFF_REQUIRES_ONLINE',
          'No se puede verificar la estación financiera. Conéctate para resolver el estado de caja.'
        );
      }

      applyCashState(result);

      const current = result.cashSession || result.cash_session || null;
      if (isSessionForStation(current, result.cashStationId, mode.actor.actorKey)) return current;

      throw createCajaNeedsOpeningError();
    }

    const localState = await cashRepository.getCurrentCashSession({ force: true });
    if (localState?.success === false) {
      const error = new Error(localState.message || 'No se pudo verificar la caja local.');
      error.code = localState.code || 'CASH_CURRENT_FAILED';
      throw error;
    }
    if (localState?.financialStatus === 'HANDOFF_REQUIRED' || localState?.financialCode === 'CASH_HANDOFF_REQUIRED') {
      throw createCashFinancialGateError(
        'CASH_HANDOFF_REQUIRED',
        'La caja anterior sigue abierta y requiere reconciliación.'
      );
    }
    if (localState?.financialStatus === 'BLOCKED') {
      throw createCashFinancialGateError(
        localState.financialCode || 'CASH_STATION_UNRESOLVED',
        'No se puede determinar de forma segura la estación financiera.'
      );
    }

    const localCurrent = localState?.cashSession || localState?.cash_session || null;
    if (isSessionForStation(localCurrent, localState?.cashStationId, mode.actor.actorKey)) {
      applyCashState(localState);
      return localCurrent;
    }
    applyCashState(localState);

    if (getCashOpeningPolicy() !== CASH_OPENING_POLICY.AUTOMATIC) {
      throw createCajaNeedsOpeningError('La caja requiere apertura manual. Confirma el fondo, el conteo y el empleado responsable.');
    }

    const suggestedAmount = aperturaPendiente?.montoSugerido || '0';
    const suggestedAmountSafe = Money.init(suggestedAmount);

    if (suggestedAmountSafe.gt(0)) {
      const formattedAmount = Money.toNumber(suggestedAmountSafe).toFixed(2);
      const confirmed = await showConfirmModal(
        `La caja se abrirá automáticamente con $${formattedAmount} según el cierre anterior.\n\nSi no tienes ese efectivo físico en caja, cancela y cambia a apertura manual.`,
        {
          title: 'Confirmar fondo heredado',
          confirmButtonText: 'Sí, abrir con ese fondo',
          cancelButtonText: 'No, abrir manualmente'
        }
      );

      if (!confirmed) {
        switchCashOpeningToManual();
        showMessageModal('Cambiamos la caja a apertura manual para que confirmes el efectivo real.', null, { type: 'warning' });
        await sincronizarEstadoCaja();
        throw createCajaNeedsOpeningError('La caja requiere apertura manual. Confirma el fondo, el conteo y el empleado responsable.');
      }
    }

    const autoOpening = buildAutomaticOpeningData(suggestedAmount, 'operation_requires_cash');
    const response = await cashRepository.openCashSession(autoOpening);
    await sincronizarEstadoCaja();
    if (response?.success === false) throw new Error(response.message || 'No se pudo abrir caja automaticamente.');
    return response.cashSession || null;
  }, [aperturaPendiente, applyCashState, sincronizarEstadoCaja]);

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

      if (!mode.cloudEnabled && getCashOpeningPolicy() === CASH_OPENING_POLICY.AUTOMATIC && fondoSiguienteSafe.eq(0)) {
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

    const amounts = resolveCashSessionAmounts(cajaActual, totalesTurno, { isCloudCash });
    const reconciliation = amounts.reconciliation || null;
    const totalTeorico = Money.init(amounts.totalTeorico);
    const elapsedMs = Date.now() - new Date(cajaActual.fecha_apertura).getTime();
    const elapsedHours = Math.max(elapsedMs / (1000 * 60 * 60), 0.01);
    const totalIngresos = Money.add(
      Money.init(amounts.fondoInicial),
      Money.add(
        Money.init(amounts.ventasContado),
        Money.add(Money.init(amounts.abonosFiado), Money.init(amounts.entradasEfectivo))
      )
    );
    const totalSalidas = Money.init(amounts.salidasEfectivo);

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
      fondoInicial: amounts.fondoInicial,
      ventasContado: amounts.ventasContado,
      abonosFiado: amounts.abonosFiado,
      entradasExtras: amounts.entradasEfectivo,
      reconciliation,
      ventasPorHora: Money.toExactString(Money.divide(Money.init(amounts.ventasContado), elapsedHours)),
      ticketPromedioEstimado: Money.toExactString(Money.divide(Money.init(amounts.ventasContado), Math.max(movimientosCaja.length, 1))),
      totalMovimientos: movimientosCaja.length,
      movimientosEntrada: movimientosCaja.filter((m) => ['entrada', 'ajuste_entrada'].includes(m.tipo)).length,
      movimientosSalida: movimientosCaja.filter((m) => ['salida', 'ajuste_salida'].includes(m.tipo)).length,
      alertas: {
        excesoLiquidez: totalTeorico.gt(CAJA_CONFIG.MAX_CASH_THRESHOLD),
        salidasSignificativas: Money.init(amounts.salidasEfectivo).gt(Money.multiply(totalIngresos, 0.3))
      }
    };
  }, [cajaActual, isCloudCash, movimientosCaja, totalesTurno]);

  const exportarReporteCajaCSV = useCallback(async () => {
    if (!cajaActual) return { success: false, error: 'No hay caja activa para exportar' };

    try {
      const resumen = await obtenerResumenEstadistico();
      const fechaCorte = new Date().toISOString().split('T')[0];
      const headers = ['Concepto', 'Valor', 'Tipo', 'Notas', 'Origen', 'Tipo de referencia', 'ID de referencia', 'ID de apartado', 'ID de pago', 'Estado financiero'];
      const reconciliation = resumen.reconciliation || {};
      const rows = [
        ['Fecha Apertura', new Date(cajaActual.fecha_apertura).toLocaleString(), 'info', ''],
        ['Responsable', cajaActual.responsable_apertura || cajaActual.responsibleName || '', 'info', ''],
        ['Estado', cajaActual.estado, 'info', ''],
        ['Total Teórico Caja', `$${Money.toNumber(resumen.totalTeorico).toFixed(2)}`, 'total', ''],
        ['Fondo Inicial', `$${Money.toNumber(resumen.fondoInicial).toFixed(2)}`, 'ingreso', ''],
        ['Ventas directas en efectivo', `$${Money.toNumber(reconciliation.directCashSales ?? resumen.ventasContado).toFixed(2)}`, 'ingreso', '', '', '', '', '', '', 'reconocida'],
        ['Apartados entregados', `$${Money.toNumber(reconciliation.layawayCompletedRevenue).toFixed(2)}`, 'venta reconocida', '', 'layaway_conversion', 'layaway', '', '', '', 'reconocida'],
        ['Anticipos pendientes', `$${Money.toNumber(reconciliation.layawayPendingAdvances).toFixed(2)}`, 'anticipo', '', 'layaway_payment', 'layaway', '', '', '', 'pendiente de reconocer'],
        ['Cobros de fiado', `$${Money.toNumber(reconciliation.customerCreditCollections ?? resumen.abonosFiado).toFixed(2)}`, 'ingreso', '', 'customer_payment', 'customer', '', '', '', 'cobrado'],
        ['Entradas manuales', `$${Money.toNumber(reconciliation.manualEntries ?? resumen.entradasExtras).toFixed(2)}`, 'ingreso', '', 'manual', '', '', '', '', 'manual'],
        ['Ajustes positivos', `$${Money.toNumber(reconciliation.positiveAdjustments).toFixed(2)}`, 'ingreso', '', 'cash_adjustment', '', '', '', '', 'ajuste'],
        ['Salidas', `$${Money.toNumber(resumen.totalSalidas).toFixed(2)}`, 'egreso', '', '', '', '', '', '', 'salida'],
        ['Ventas reconocidas totales', `$${Money.toNumber(reconciliation.recognizedSales).toFixed(2)}`, 'resumen', '', '', '', '', '', '', 'reconocida'],
        ['Costo reconocido (apartados)', `$${Money.toNumber(reconciliation.layawayCompletedCost).toFixed(2)}`, 'resumen', '', 'layaway_conversion', 'layaway', '', '', '', 'reconocido'],
        ['Ganancia bruta reconocida (apartados)', `$${Money.toNumber(reconciliation.layawayCompletedGrossProfit).toFixed(2)}`, 'resumen', '', 'layaway_conversion', 'layaway', '', '', '', 'reconocida'],
        ['Diferencia sin clasificar', `$${Money.toNumber(reconciliation.unclassifiedDifference).toFixed(2)}`, 'resumen', '', '', '', '', '', '', 'conciliación'],
        ...movimientosCaja.map((mov) => [
          `Movimiento: ${mov.concepto}`,
          `$${Money.toNumber(mov.monto).toFixed(2)}`,
          mov.tipo,
          new Date(mov.fecha).toLocaleString(),
          mov.source || mov.origen || '',
          mov.referenceType || '',
          mov.referenceId || '',
          mov.layawayId || '',
          mov.paymentId || '',
          mov.source === 'layaway_payment' ? 'anticipo / abono' : (mov.source === 'layaway_refund' ? 'reembolso' : '')
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

  const getCashSessionDetailForAudit = useCallback((cashSessionId, options = {}) => (
    cashRepository.getCashSessionDetailForAudit({ cashSessionId, ...options })
  ), []);

  const cerrarCajaAdministrativamente = useCallback(async (input = {}) => {
    const response = await cashRepository.adminCloseCashSession(input);
    if (response?.success) await sincronizarEstadoCaja();
    return response;
  }, [sincronizarEstadoCaja]);

  const adoptarCajaLegacy = useCallback(async (cashSessionId, expectedVersion = null) => {
    const response = await cashRepository.adoptLegacyCashSession({ cashSessionId, expectedVersion });
    if (response?.success) await sincronizarEstadoCaja();
    return response;
  }, [sincronizarEstadoCaja]);

  const modeSnapshot = useMemo(() => ({
    cashMode,
    isCloudCash,
    isCloudCashReadOnly,
    stateKnown: cashMode.stateKnown !== false,
    networkUnavailable: Boolean(cashMode.networkUnavailable),
    isRetrying,
    cashActor,
    adminCashSessions,
    legacyAdminCashSessions
  }), [adminCashSessions, cashActor, cashMode, isCloudCash, isCloudCashReadOnly, isRetrying, legacyAdminCashSessions]);

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
    reintentarVerificacion,
    obtenerResumenEstadistico,
    exportarReporteCajaCSV,
    descargarReporteCaja,
    verificarExcesoLiquidez,
    listCashSessionsForAudit,
    getCashSessionDetailForAudit,
    cerrarCajaAdministrativamente,
    adoptarCajaLegacy,
    ...modeSnapshot,
    CAJA_CONFIG
  };
}
