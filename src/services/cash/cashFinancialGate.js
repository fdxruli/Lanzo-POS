import {
  ACTOR_RUNTIME_ERROR_CODES,
  ACTOR_RUNTIME_STATUS,
  ActorRuntimeError,
  actorRuntimeController
} from '../auth/actorRuntimeController';
import { areCashStationsEquivalent } from './cashStation';

/**
 * Financial access is deliberately narrower than application access.  A
 * granted actor may browse the POS while this gate still blocks cash writes.
 */
export const CASH_FINANCIAL_STATUS = Object.freeze({
  READY: 'READY',
  NO_SESSION: 'NO_SESSION',
  OWN_SESSION_OPEN: 'OWN_SESSION_OPEN',
  HANDOFF_REQUIRED: 'HANDOFF_REQUIRED',
  RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED',
  BLOCKED: 'BLOCKED'
});

export const CASH_FINANCIAL_CODES = Object.freeze({
  HANDOFF_REQUIRED: 'CASH_HANDOFF_REQUIRED',
  HANDOFF_REQUIRES_ONLINE: 'CASH_HANDOFF_REQUIRES_ONLINE',
  STATION_UNRESOLVED: 'CASH_STATION_UNRESOLVED',
  STATION_MISMATCH: 'CASH_SESSION_STATION_MISMATCH',
  SESSION_FORBIDDEN: 'CASH_SESSION_FORBIDDEN',
  SESSION_REQUIRED: 'CASH_SESSION_REQUIRED',
  SESSION_NOT_OPEN: 'CASH_SESSION_NOT_OPEN'
});

export class CashFinancialError extends Error {
  constructor(code, message = code, details = {}) {
    super(message);
    this.name = 'CashFinancialError';
    this.code = code;
    this.status = details.status || null;
    this.details = details;
  }
}

const sessionActorKey = (session) => session?.actorKey || session?.actor_key || null;
const sessionStationId = (session) => session?.cashStationId
  || session?.cash_station_id
  || session?.metadata?.cashStationId
  || session?.metadata?.cash_station_id
  || null;
const isOpen = (session) => session?.estado === 'abierta' || session?.status === 'open';

export const isCashFinancialStatusReady = (status) => (
  status === CASH_FINANCIAL_STATUS.READY
  || status === CASH_FINANCIAL_STATUS.OWN_SESSION_OPEN
);

/**
 * Pure state reducer used by cloud, local and offline paths.  It never treats
 * an open session belonging to another actor as the current session.
 */
export const deriveCashFinancialState = ({
  actorKey = null,
  cashSession = null,
  stationOpenCashSession = null,
  cashStationId = null,
  online = true,
  cloudEnabled = false,
  stateKnown = true,
  stationResolved = true
} = {}) => {
  const ownSession = isOpen(cashSession) && sessionActorKey(cashSession) === actorKey;
  const stationSession = isOpen(stationOpenCashSession)
    ? stationOpenCashSession
    : (ownSession ? cashSession : null);
  const stationOwner = sessionActorKey(stationSession);

  if (!stationResolved) {
    return {
      status: CASH_FINANCIAL_STATUS.BLOCKED,
      code: CASH_FINANCIAL_CODES.STATION_UNRESOLVED,
      cashStationId,
      cashSession: null,
      stationOpenCashSession: stationSession,
      actorKey,
      online,
      stateKnown
    };
  }

  if (cloudEnabled && !online && !stateKnown) {
    return {
      status: CASH_FINANCIAL_STATUS.BLOCKED,
      code: CASH_FINANCIAL_CODES.HANDOFF_REQUIRES_ONLINE,
      cashStationId,
      cashSession: null,
      stationOpenCashSession: null,
      actorKey,
      online,
      stateKnown: false
    };
  }

  if (stationSession && stationOwner && stationOwner !== actorKey) {
    return {
      status: CASH_FINANCIAL_STATUS.HANDOFF_REQUIRED,
      code: CASH_FINANCIAL_CODES.HANDOFF_REQUIRED,
      cashStationId,
      cashSession: null,
      stationOpenCashSession: stationSession,
      actorKey,
      online,
      stateKnown
    };
  }

  if (ownSession) {
    return {
      status: CASH_FINANCIAL_STATUS.OWN_SESSION_OPEN,
      code: null,
      cashStationId: cashStationId || sessionStationId(cashSession),
      cashSession,
      stationOpenCashSession: stationSession || cashSession,
      actorKey,
      online,
      stateKnown
    };
  }

  return {
    status: CASH_FINANCIAL_STATUS.NO_SESSION,
    code: null,
    cashStationId,
    cashSession: null,
    stationOpenCashSession: stationSession,
    actorKey,
    online,
    stateKnown
  };
};

export const assertCashFinancialWriteAccess = ({
  state,
  cashSessionId = null,
  actorKey = null,
  cashStationId = null,
  operation = 'cash mutation'
} = {}) => {
  if (!state || !isCashFinancialStatusReady(state.status)) {
    const code = state?.code || (
      state?.status === CASH_FINANCIAL_STATUS.HANDOFF_REQUIRED
        ? CASH_FINANCIAL_CODES.HANDOFF_REQUIRED
        : CASH_FINANCIAL_CODES.SESSION_REQUIRED
    );
    throw new CashFinancialError(code, `${operation} bloqueada: ${code}.`, {
      status: state?.status || CASH_FINANCIAL_STATUS.BLOCKED,
      state
    });
  }

  const session = state.cashSession;
  if (!isOpen(session)) {
    throw new CashFinancialError(CASH_FINANCIAL_CODES.SESSION_REQUIRED, `${operation} requiere una caja abierta.`, {
      status: CASH_FINANCIAL_STATUS.NO_SESSION,
      state
    });
  }

  const owner = sessionActorKey(session);
  if (actorKey && owner && owner !== actorKey) {
    throw new CashFinancialError(CASH_FINANCIAL_CODES.HANDOFF_REQUIRED, `${operation} no puede usar la sesión de otro actor.`, {
      status: CASH_FINANCIAL_STATUS.HANDOFF_REQUIRED,
      state
    });
  }

  const station = sessionStationId(session);
  if (cashStationId && station && !areCashStationsEquivalent(cashStationId, station)) {
    throw new CashFinancialError(CASH_FINANCIAL_CODES.STATION_MISMATCH, `${operation} no corresponde a la estación financiera actual.`, {
      status: CASH_FINANCIAL_STATUS.BLOCKED,
      state
    });
  }

  if (cashSessionId && session.id !== cashSessionId) {
    throw new CashFinancialError(CASH_FINANCIAL_CODES.HANDOFF_REQUIRED, `${operation} apunta a otra sesión financiera.`, {
      status: CASH_FINANCIAL_STATUS.HANDOFF_REQUIRED,
      state
    });
  }

  return session;
};

/**
 * Captures the real ActorRuntime generation immediately before a cash write.
 * LOCKED, AUTHENTICATING and HANDOFF_CHECK therefore fail at the financial
 * boundary without blocking non-financial application capabilities.
 */
export const captureCashActorContext = () => {
  const runtimeState = actorRuntimeController.getState();
  if (runtimeState.status !== ACTOR_RUNTIME_STATUS.GRANTED) {
    throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.CONTEXT_LOCKED, {
      status: runtimeState.status,
      reason: 'cash_financial_gate_requires_granted_actor'
    });
  }
  return actorRuntimeController.capture();
};

export const assertCashActorContextCurrent = (handle) => {
  if (!handle || typeof handle.assertCurrent !== 'function') {
    throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.CONTEXT_STALE, {
      reason: 'cash_actor_handle_required'
    });
  }
  return handle.assertCurrent();
};

export default Object.freeze({
  CASH_FINANCIAL_STATUS,
  CASH_FINANCIAL_CODES,
  CashFinancialError,
  deriveCashFinancialState,
  assertCashFinancialWriteAccess,
  captureCashActorContext,
  assertCashActorContextCurrent
});
