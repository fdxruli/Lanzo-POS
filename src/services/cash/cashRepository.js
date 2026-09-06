import Logger from '../Logger';
import { showMessageModal } from '../utils';
import { Money } from '../../utils/moneyMath';
import { invalidateCloudCacheAfterCashMutation } from '../cloud';
import { generateIdempotencyKey } from '../sync/idempotency';
import {
  SYNC_ENTITY_TYPES,
  SYNC_OPERATIONS
} from '../sync/syncConstants';
import { posSyncOrchestrator } from '../sync/posSyncOrchestrator';
import { cashCloudRepository } from './cashCloudRepository';
import { cashLocalRepository, getCashLocalProjectionDiagnostics } from './cashLocalRepository';
import {
  areCashStationsEquivalent,
  getCashStationIdFromCloudResponse,
  getCashStationIdentity
} from './cashStation';
import {
  CASH_FINANCIAL_CODES,
  CASH_FINANCIAL_STATUS,
  assertCashFinancialWriteAccess,
  captureCashActorContext,
  CashFinancialError,
  deriveCashFinancialState
} from './cashFinancialGate';
import {
  CASH_CLOUD_OFFLINE_MESSAGE,
  getCashMode
} from './cashActor';
import {
  CASH_NETWORK_UNAVAILABLE_CODE,
  CASH_NETWORK_UNAVAILABLE_MESSAGE,
  isCashNetworkUnavailableError,
  normalizeCashNetworkError
} from './cashNetwork';
import { assertCanUseCashRegister, canAuditCashSessions } from './cashPermissions';
import {
  localClosingToCloudPayload,
  localOpeningToCloudPayload
} from './cashMapper';
import { markFinancialIntentProjectionApplied, markFinancialIntentProjectionFailed } from '../financial/financialIntentLedger';
import { registerFinancialProjectionHandler } from '../financial/financialProjectionRegistry';

import './cashSyncHandler';

const fail = (message, code = 'CASH_ERROR', extra = {}) => ({
  success: false,
  code,
  message,
  ...extra
});

const ADMIN_CLOSE_REVIEW_CODES = new Set(['VERSION_CONFLICT', 'CASH_TOTALS_CHANGED']);

const cashProjectionDiagnostics = {
  invalidCashSessionRecords: 0,
  invalidCashMovementRecords: 0
};

let cashNetworkWarningActive = false;

const isRecord = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));

const isCompleteCloudCashSession = (value) => Boolean(
  isRecord(value)
  && value.id
  && (
    value.status
    || value.opened_at
    || value.created_at
    || value.actor_key
    || value.cash_station_id
    || value.cashStationId
  )
);

const isCompleteCloudCashMovement = (value) => Boolean(
  isRecord(value)
  && value.id
  && (value.cash_session_id || value.cashSessionId)
  && (value.type || value.tipo)
  && (value.amount !== undefined || value.monto !== undefined)
);

const recordInvalidCloudProjection = (kind) => {
  if (kind === 'session') cashProjectionDiagnostics.invalidCashSessionRecords += 1;
  if (kind === 'movement') cashProjectionDiagnostics.invalidCashMovementRecords += 1;
};

export const getCashProjectionDiagnostics = () => {
  const local = getCashLocalProjectionDiagnostics();
  return {
    invalidCashSessionRecords: cashProjectionDiagnostics.invalidCashSessionRecords
      + local.invalidCashSessionRecords,
    invalidCashMovementRecords: cashProjectionDiagnostics.invalidCashMovementRecords
      + local.invalidCashMovementRecords
  };
};

const normalizeAmount = (value) => Money.toExactString(Money.init(value || 0));

const showOfflineCashMessage = () => {
  showMessageModal(CASH_CLOUD_OFFLINE_MESSAGE, null, { type: 'warning' });
};

const logCashNetworkUnavailableOnce = (error) => {
  if (cashNetworkWarningActive) return;
  cashNetworkWarningActive = true;
  Logger.warn('[Cash] Sin conexión con Supabase; la cache local queda en solo consulta:', error);
};

const getStationForMode = async () => getCashStationIdentity();

const normalizeCashMutationError = (error, fallbackCode = 'CASH_ERROR') => {
  const message = String(error?.message || error || 'No se pudo completar la operación de caja.');
  const knownCode = error?.code
    || Object.values(CASH_FINANCIAL_CODES).find((code) => message.includes(code))
    || (message.includes('CASH_SESSION_FORBIDDEN') ? CASH_FINANCIAL_CODES.HANDOFF_REQUIRED : null)
    || fallbackCode;
  const normalized = error instanceof CashFinancialError
    ? error
    : new CashFinancialError(knownCode, message, { cause: error });
  return normalized;
};

const captureFinancialActor = () => captureCashActorContext();

const buildFinancialResult = ({ mode, result, station, stationOpenCashSession = null, cashSession = null } = {}) => {
  const state = deriveCashFinancialState({
    actorKey: mode.actor.actorKey,
    cashSession,
    stationOpenCashSession,
    cashStationId: station?.cashStationId || null,
    online: mode.online,
    cloudEnabled: mode.cloudEnabled,
    stateKnown: result?.stateKnown !== false,
    stationResolved: Boolean(station?.cashStationId),
    networkUnavailable: Boolean(result?.networkUnavailable)
  });
  return {
    ...result,
    financialStatus: state.status === CASH_FINANCIAL_STATUS.HANDOFF_REQUIRED || state.status === CASH_FINANCIAL_STATUS.BLOCKED
      ? state.status
      : (result?.financialStatus || state.status),
    financialCode: state.code || result?.financialCode || null,
    financialState: state,
    cashStationId: station?.cashStationId || result?.cashStationId || null,
    stationOpenCashSession: stationOpenCashSession || result?.stationOpenCashSession || null,
    cashSession: cashSession || result?.cashSession || null,
    networkUnavailable: Boolean(result?.networkUnavailable)
  };
};

const getSessionStationId = (session) => session?.cash_station_id
  || session?.cashStationId
  || session?.metadata?.cash_station_id
  || session?.metadata?.cashStationId
  || null;

const withStationEvidence = (session, cashStationId) => (
  session && !getSessionStationId(session) && cashStationId
    ? { ...session, cash_station_id: cashStationId }
    : session
);

const assertSessionForStation = (session, cashStationId, message = 'La respuesta cloud contiene una sesión de otra estación.') => {
  if (!session || !cashStationId) return session;
  const sessionWithEvidence = withStationEvidence(session, cashStationId);
  const sessionStationId = getSessionStationId(sessionWithEvidence);
  if (!areCashStationsEquivalent(sessionStationId, cashStationId)) {
    throw new CashFinancialError(CASH_FINANCIAL_CODES.STATION_MISMATCH, message, {
      sessionStationId,
      cashStationId
    });
  }
  return sessionWithEvidence;
};

const assertResponseOwnSession = (response, mode, cashStationId = null) => {
  const session = response?.cash_session || response?.cashSession || null;
  const responseActor = response?.actor_key || response?.actorKey || null;
  if (responseActor && responseActor !== mode.actor.actorKey) {
    throw new CashFinancialError(CASH_FINANCIAL_CODES.HANDOFF_REQUIRED, 'La respuesta cloud pertenece a otro actor.', {
      responseActorKey: responseActor,
      actorKey: mode.actor.actorKey
    });
  }
  const owner = session?.actor_key || session?.actorKey || null;
  if (session && owner !== mode.actor.actorKey) {
    throw new CashFinancialError(CASH_FINANCIAL_CODES.HANDOFF_REQUIRED, 'La respuesta cloud contiene una sesión de otro actor.', {
      ownerActorKey: owner,
      actorKey: mode.actor.actorKey
    });
  }
  const responseStationId = getCashStationIdFromCloudResponse(response);
  if (responseStationId && cashStationId && !areCashStationsEquivalent(responseStationId, cashStationId)) {
    throw new CashFinancialError(CASH_FINANCIAL_CODES.STATION_MISMATCH, 'La respuesta cloud contiene una estación de otra estación.', {
      responseStationId,
      cashStationId
    });
  }
  return assertSessionForStation(
    session,
    responseStationId || cashStationId,
    undefined
  );
};

const assertCloudResponseStation = ({ response, localStation } = {}) => {
  const serverCashStationId = getCashStationIdFromCloudResponse(response);
  if (!serverCashStationId) {
    throw new CashFinancialError(
      CASH_FINANCIAL_CODES.STATION_UNRESOLVED,
      'La respuesta cloud no contiene una estación financiera canónica.',
      { response }
    );
  }

  const resolvedCashStationId = response?.resolvedCashStationId || null;
  if (resolvedCashStationId && !areCashStationsEquivalent(serverCashStationId, resolvedCashStationId)) {
    throw new CashFinancialError(
      CASH_FINANCIAL_CODES.STATION_MISMATCH,
      'La respuesta cloud contiene una estación financiera inconsistente.',
      { serverCashStationId, resolvedCashStationId }
    );
  }

  // `resolvedCashStationId` is the server-side preflight result produced by
  // the financial intent ledger. When it is available it is the authority;
  // the local id is only a legacy-compatible fallback for older responses.
  if (!resolvedCashStationId && localStation?.cashStationId
    && !areCashStationsEquivalent(serverCashStationId, localStation.cashStationId)) {
    throw new CashFinancialError(CASH_FINANCIAL_CODES.STATION_MISMATCH, 'La respuesta cloud contiene una sesión de otra estación.', {
      serverCashStationId,
      localCashStationId: localStation.cashStationId
    });
  }

  const session = response?.cash_session || response?.cashSession || null;
  if (session) assertSessionForStation(session, serverCashStationId);
  return serverCashStationId;
};

export const cashRepositoryInternals = Object.freeze({
  assertSessionForStation,
  assertResponseOwnSession,
  assertCloudResponseStation,
  isCompleteCloudCashSession,
  isCompleteCloudCashMovement
});

const assertCurrentFinancialSessionForMutation = async ({
  mode,
  station,
  cashSessionId,
  actorContext,
  operation
} = {}) => {
  actorContext?.assertCurrent?.();
  const current = await cashRepository.getCurrentCashSession({ force: true });
  if (current?.success === false) {
    throw new CashFinancialError(current.code || CASH_FINANCIAL_CODES.SESSION_REQUIRED, current.message || 'No se pudo verificar la sesión financiera.', { current });
  }
  const state = current.financialState || deriveCashFinancialState({
    actorKey: mode.actor.actorKey,
    cashSession: current.cashSession,
    stationOpenCashSession: current.stationOpenCashSession,
    cashStationId: current.cashStationId || station?.cashStationId,
    online: mode.online,
    cloudEnabled: mode.cloudEnabled,
    stateKnown: current.stateKnown !== false,
    networkUnavailable: current.networkUnavailable === true
  });
  return assertCashFinancialWriteAccess({
    state,
    cashSessionId,
    actorKey: mode.actor.actorKey,
    cashStationId: current.cashStationId || station?.cashStationId,
    operation
  });
};

const applyCloudResponse = async (response = {}) => {
  const applied = {
    cashSession: null,
    movement: null,
    cashSessions: [],
    movements: []
  };

  const serverCashStationId = getCashStationIdFromCloudResponse(response);
  const withServerCashStation = (record) => {
    if (!record || !serverCashStationId || getSessionStationId(record)) return record;
    return { ...record, cash_station_id: serverCashStationId };
  };

  const validCashSession = (record) => {
    if (!isCompleteCloudCashSession(record)) {
      recordInvalidCloudProjection('session');
      return null;
    }
    return withServerCashStation(record);
  };

  const validCashMovement = (record) => {
    if (!isCompleteCloudCashMovement(record)) {
      recordInvalidCloudProjection('movement');
      return null;
    }
    return withServerCashStation(record);
  };

  if (response.cash_session !== undefined && response.cash_session !== null) {
    applied.cashSession = await cashLocalRepository.applyCloudCashSession(
      validCashSession(response.cash_session)
    );
  }

  if (response.movement !== undefined && response.movement !== null) {
    applied.movement = await cashLocalRepository.applyCloudCashMovement(
      validCashMovement(response.movement)
    );
  }

  if (Array.isArray(response.cash_sessions)) {
    const validCashSessions = response.cash_sessions
      .map(validCashSession)
      .filter(Boolean);
    applied.cashSessions = await cashLocalRepository.applyCloudCashSessions(validCashSessions);
  }

  if (Array.isArray(response.movements)) {
    const validCashMovements = response.movements
      .map(validCashMovement)
      .filter(Boolean);
    applied.movements = await cashLocalRepository.applyCloudCashMovements(validCashMovements);
  }

  return applied;
};

export const applyCashFinancialResponseProjection = async ({ responsePayload, actorHandle }) => {
  actorHandle?.assertCurrent?.();
  const applied = await applyCloudResponse(responsePayload || {});
  actorHandle?.assertCurrent?.();
  return applied;
};

const applyFinancialCloudResponse = async ({ response, actorContext }) => {
  try {
    const applied = await applyCashFinancialResponseProjection({ responsePayload: response, actorHandle: actorContext });
    if (response?.financialIntentId) {
      await markFinancialIntentProjectionApplied({ intentId: response.financialIntentId, actorHandle: actorContext });
    }
    return applied;
  } catch (error) {
    if (response?.financialIntentId) {
      await markFinancialIntentProjectionFailed({ intentId: response.financialIntentId, errorCode: error?.code || 'CASH_LOCAL_PROJECTION_FAILED', actorHandle: actorContext });
    }
    throw error;
  }
};

['cash.open', 'cash.movement', 'cash.adjust_initial_fund', 'cash.close', 'cash.admin_close'].forEach((operationType) => {
  registerFinancialProjectionHandler(operationType, applyCashFinancialResponseProjection);
});

const getCachedScope = async (mode, { limit = 50, networkUnavailable = false } = {}) => {
  const actor = mode.actor;
  let station = null;
  try {
    station = await getStationForMode();
  } catch (stationError) {
    Logger.warn('[Cash] No se pudo resolver la estación local:', stationError);
  }
  const financial = await cashLocalRepository.getFinancialState({
    actorKey: actor.actorKey,
    cashStationId: station?.cashStationId || null,
    online: mode.online,
    cloudEnabled: mode.cloudEnabled,
    stateKnown: !mode.cloudEnabled && !networkUnavailable
  });
  const cashSession = financial.cashSession;
  const projection = cashSession
    ? await cashLocalRepository.loadProjection(cashSession)
    : { movements: [], totals: { ventasContado: '0', abonosFiado: '0' } };
  const cashSessions = await cashLocalRepository.getHistory({
    actorKey: actor.actorKey,
    staffUserId: actor.staffUserId,
    isAdmin: false,
    limit
  });

  return buildFinancialResult({
    mode,
    station,
    cashSession,
    stationOpenCashSession: financial.stationOpenCashSession,
    result: {
      success: true,
      readOnly: mode.readOnly,
      movements: projection.movements,
      totals: projection.totals,
      cashSessions,
      actor,
      mode,
      stateKnown: financial.stateKnown,
      financialStatus: financial.status,
      financialCode: financial.code,
      networkUnavailable
    }
  });
};

const getSafeCachedScope = async (mode, options = {}) => {
  try {
    return await getCachedScope(mode, options);
  } catch (error) {
    Logger.warn('[Cash] No se pudo leer la cache local; se conserva el bloqueo financiero:', error);
    return {
      success: true,
      readOnly: true,
      stateKnown: false,
      networkUnavailable: Boolean(options.networkUnavailable),
      financialStatus: CASH_FINANCIAL_STATUS.BLOCKED,
      financialCode: options.networkUnavailable
        ? CASH_NETWORK_UNAVAILABLE_CODE
        : CASH_FINANCIAL_CODES.SESSION_REQUIRED,
      financialState: {
        status: CASH_FINANCIAL_STATUS.BLOCKED,
        code: options.networkUnavailable
          ? CASH_NETWORK_UNAVAILABLE_CODE
          : CASH_FINANCIAL_CODES.SESSION_REQUIRED,
        stateKnown: false,
        networkUnavailable: Boolean(options.networkUnavailable),
        cashSession: null,
        stationOpenCashSession: null,
        cashStationId: null,
        actorKey: mode.actor.actorKey,
        online: mode.online,
        cloudEnabled: mode.cloudEnabled
      },
      cashSession: null,
      cashSessions: [],
      movements: [],
      totals: { ventasContado: '0', abonosFiado: '0' },
      actor: mode.actor,
      mode
    };
  }
};

const buildNetworkUnavailableScope = async (mode) => {
  const cached = await getSafeCachedScope(mode, { networkUnavailable: true });
  return {
    ...cached,
    success: true,
    readOnly: true,
    stateKnown: false,
    networkUnavailable: true,
    warning: CASH_NETWORK_UNAVAILABLE_MESSAGE,
    financialStatus: CASH_FINANCIAL_STATUS.BLOCKED,
    financialCode: CASH_NETWORK_UNAVAILABLE_CODE,
    financialState: {
      ...(cached.financialState || {}),
      status: CASH_FINANCIAL_STATUS.BLOCKED,
      code: CASH_NETWORK_UNAVAILABLE_CODE,
      stateKnown: false,
      networkUnavailable: true,
      online: mode.online,
      cloudEnabled: mode.cloudEnabled
    }
  };
};

export const cashRepository = {
  getMode: getCashMode,

  async getCurrentCashSession({ force = false } = {}) {
    const mode = getCashMode();

    if (!mode.cloudEnabled) {
      return getSafeCachedScope({ ...mode, readOnly: false }, { networkUnavailable: false });
    }

    if (!mode.online) {
      logCashNetworkUnavailableOnce({ code: CASH_NETWORK_UNAVAILABLE_CODE, message: CASH_NETWORK_UNAVAILABLE_MESSAGE });
      return buildNetworkUnavailableScope(mode);
    }

    let station = null;
    try {
      station = await getStationForMode();
    } catch (stationError) {
      Logger.warn('[Cash] Estación financiera no resuelta:', stationError);
    }

    assertCanUseCashRegister();

    try {
      const response = await cashCloudRepository.getCurrentCashSession({ licenseKey: mode.licenseKey, force });
      if (response?.success === false) {
        if (isCashNetworkUnavailableError(response)) {
          throw normalizeCashNetworkError(response, { rpcName: 'pos_get_current_cash_session' });
        }
        return fail(response.message || 'No se pudo cargar la caja cloud.', response.code || 'CASH_CURRENT_FAILED', { response });
      }

      const stationState = await cashCloudRepository.getCashStationState({
        licenseKey: mode.licenseKey,
        force
      });
      if (stationState?.success === false || !stationState?.cash_station) {
        if (isCashNetworkUnavailableError(stationState)) {
          throw normalizeCashNetworkError(stationState, { rpcName: 'pos_get_cash_station_state' });
        }
        throw new CashFinancialError(
          stationState?.code || CASH_FINANCIAL_CODES.STATION_UNRESOLVED,
          stationState?.message || 'No se pudo verificar la estación financiera.',
          { stationState }
        );
      }
      const stationId = assertCloudResponseStation({ response: stationState, localStation: station });
      const currentSession = assertResponseOwnSession(response, mode, stationId);
      const stationOpenCashSession = assertSessionForStation(stationState?.station_open_cash_session
        || stationState?.stationOpenCashSession
        || null, stationId);

      if (currentSession && !isCompleteCloudCashSession(currentSession)) {
        recordInvalidCloudProjection('session');
        throw new CashFinancialError(
          'CASH_CURRENT_RESPONSE_INVALID',
          'La respuesta cloud no contiene una sesión de caja completa.',
          { response }
        );
      }
      if (stationOpenCashSession && !isCompleteCloudCashSession(stationOpenCashSession)) {
        recordInvalidCloudProjection('session');
        throw new CashFinancialError(
          'CASH_STATION_STATE_INVALID',
          'La respuesta cloud no contiene una sesión de estación completa.',
          { stationState }
        );
      }

      const applied = await applyCloudResponse(response);
      if (stationOpenCashSession && stationOpenCashSession.id !== currentSession?.id) {
        await cashLocalRepository.applyCloudCashSession(stationOpenCashSession);
      }
      const cashSession = applied.cashSession && (
        (applied.cashSession.actorKey || applied.cashSession.actor_key || response.actor_key) === mode.actor.actorKey
        && areCashStationsEquivalent(getSessionStationId(applied.cashSession), stationId)
      ) ? applied.cashSession : null;
      if (currentSession && !cashSession) {
        throw new CashFinancialError(
          'CASH_CURRENT_RESPONSE_INVALID',
          'La sesión cloud no pudo proyectarse de forma segura en la cache local.',
          { response }
        );
      }
      const projection = cashSession
        ? await cashLocalRepository.loadProjection(cashSession)
        : { movements: [], totals: { ventasContado: '0', abonosFiado: '0' } };

      let cashSessions = [];
      try {
        const snapshot = await this.pullCashSnapshot({ scope: mode.actor.isStaff ? 'mine' : 'all', includeClosed: true, limit: 50, force });
        cashSessions = snapshot.cashSessions || [];
      } catch (snapshotError) {
        if (!isCashNetworkUnavailableError(snapshotError)) {
          Logger.warn('[Cash] Snapshot posterior a current fallo:', snapshotError);
        }
        cashSessions = await cashLocalRepository.getHistory({
          actorKey: mode.actor.actorKey,
          staffUserId: mode.actor.staffUserId,
          isAdmin: !mode.actor.isStaff,
          limit: 50
        });
      }

      cashNetworkWarningActive = false;
      return buildFinancialResult({
        mode,
        station: (stationState?.cash_station ? {
          cashStationId: stationId,
          deviceId: stationState.cash_station.device_id || null
        } : station),
        cashSession,
        stationOpenCashSession,
        result: {
          success: true,
          readOnly: false,
          movements: projection.movements,
          totals: projection.totals,
          cashSessions,
          adminOpenSessions: response.admin_open_sessions || [],
          legacyAdminCashSessions: response.legacy_admin_cash_sessions || [],
          actor: {
            ...mode.actor,
            actorKey: response.actor_key || mode.actor.actorKey,
            responsibleName: response.actor_name || mode.actor.responsibleName,
            displayName: response.actor_name || mode.actor.displayName
          },
          mode,
          response,
          stateKnown: true,
          financialStatus: stationState?.financial_status || stationState?.financialStatus || null,
          financialCode: stationState?.financial_code || stationState?.financialCode || null
        }
      });
    } catch (error) {
      const normalized = normalizeCashMutationError(error, 'CASH_CURRENT_FAILED');
      const networkUnavailable = isCashNetworkUnavailableError(error);
      if (networkUnavailable) logCashNetworkUnavailableOnce(normalized);
      else Logger.warn('[Cash] Carga cloud falló; cache local queda read-only y no libre:', normalized);
      const cached = networkUnavailable
        ? await buildNetworkUnavailableScope(mode)
        : await getSafeCachedScope({ ...mode, readOnly: true }, { networkUnavailable: false });
      return {
        ...cached,
        success: true,
        warning: networkUnavailable
          ? CASH_NETWORK_UNAVAILABLE_MESSAGE
          : (normalized.message || 'No se pudo refrescar caja cloud.'),
        readOnly: true,
        financialStatus: networkUnavailable || cached.financialStatus === CASH_FINANCIAL_STATUS.NO_SESSION
          ? CASH_FINANCIAL_STATUS.BLOCKED
          : cached.financialStatus,
        financialCode: networkUnavailable
          ? CASH_NETWORK_UNAVAILABLE_CODE
          : (cached.financialCode || normalized.code || CASH_FINANCIAL_CODES.HANDOFF_REQUIRES_ONLINE),
        stateKnown: false,
        networkUnavailable,
        financialState: networkUnavailable
          ? {
            ...(cached.financialState || {}),
            status: CASH_FINANCIAL_STATUS.BLOCKED,
            code: CASH_NETWORK_UNAVAILABLE_CODE,
            stateKnown: false,
            networkUnavailable: true
          }
          : cached.financialState
      };
    }
  },

  async openCashSession(openingData) {
    const mode = getCashMode();
    assertCanUseCashRegister();
    const station = await getStationForMode();
    const actorContext = captureFinancialActor();
    const canonicalOpeningData = {
      ...openingData,
      actorKey: mode.actor.actorKey,
      originActorKey: mode.actor.actorKey,
      actorGeneration: actorContext.generation,
      deviceId: station.deviceId,
      deviceRole: mode.actor.deviceRole,
      cashStationId: station.cashStationId,
      cashIdentityState: station.identityState
    };

    if (!mode.cloudEnabled) {
      const idempotencyKey = generateIdempotencyKey({
        entityType: SYNC_ENTITY_TYPES.CASH_SESSION,
        operation: SYNC_OPERATIONS.OPEN,
        entityId: 'current',
        prefix: 'cash_open'
      });
      canonicalOpeningData.idempotencyKey = idempotencyKey;
      const cashSession = await cashLocalRepository.openCashSession(canonicalOpeningData);
      return { success: true, cashSession };
    }

    if (!mode.online) {
      showOfflineCashMessage();
      return fail(CASH_CLOUD_OFFLINE_MESSAGE, 'CLOUD_CASH_OFFLINE');
    }

    let response;
    try {
      response = await cashCloudRepository.openCashSession({
        licenseKey: mode.licenseKey,
        opening: localOpeningToCloudPayload(canonicalOpeningData),
        idempotencyKey: null,
        actorHandle: actorContext
      });
    } catch (openError) {
      const normalized = normalizeCashMutationError(openError, 'CASH_OPEN_FAILED');
      return fail(normalized.message, normalized.code, { error: normalized });
    }

    if (response?.cash_session) {
      const serverCashStationId = assertCloudResponseStation({ response, localStation: station });
      const owner = response.cash_session.actor_key || response.cash_session.actorKey || null;
      if (response.code === CASH_FINANCIAL_CODES.HANDOFF_REQUIRED || (owner && owner !== mode.actor.actorKey)) {
        return fail('La estación financiera requiere reconciliación antes de cambiar de actor.', CASH_FINANCIAL_CODES.HANDOFF_REQUIRED, {
          response,
          stationOpenCashSession: response.cash_session
        });
      }
      const applied = await applyFinancialCloudResponse({ response, actorContext });
      invalidateCloudCacheAfterCashMutation(mode.licenseKey);
      posSyncOrchestrator.pullIncremental('cash_open').catch(() => {});
      return {
        success: response.success !== false || (
          response.code === 'CASH_SESSION_ALREADY_OPEN'
          && owner === mode.actor.actorKey
        ),
        cashSession: applied.cashSession,
        cashStationId: serverCashStationId,
        response
      };
    }

    return response?.success === false
      ? fail(response.message || 'No se pudo abrir caja cloud.', response.code || 'CASH_OPEN_FAILED', { response })
      : { success: true, response };
  },

  async registerMovement({
    cashSessionId,
    type,
    amount,
    concept,
    idempotencyKey = null,
    referenceId = null,
    metadata = {}
  }) {
    const mode = getCashMode();
    assertCanUseCashRegister();
    const station = await getStationForMode();
    const actorContext = captureFinancialActor();

    const amountSafe = normalizeAmount(amount);
    const conceptClean = String(concept || '').trim();

    if (!conceptClean) return fail('El concepto es obligatorio.', 'CONCEPT_REQUIRED');
    if (Money.init(amountSafe).lte(0)) return fail('El monto debe ser mayor a 0.', 'AMOUNT_INVALID');

    const movementMetadata = {
      ...metadata,
      ...(referenceId ? { referenceId } : {})
    };

    if (!mode.cloudEnabled) {
      return cashLocalRepository.registerMovement({
        cashSessionId,
        type,
        amount: amountSafe,
        concept: conceptClean,
        idempotencyKey,
        referenceId,
        metadata: movementMetadata,
        actorKey: mode.actor.actorKey,
        cashStationId: station.cashStationId,
        actorContext
      });
    }

    if (!mode.online) {
      showOfflineCashMessage();
      return fail(CASH_CLOUD_OFFLINE_MESSAGE, 'CLOUD_CASH_OFFLINE');
    }

    await assertCurrentFinancialSessionForMutation({
      mode,
      station,
      cashSessionId,
      actorContext,
      operation: 'cash movement'
    });

    const resolvedIdempotencyKey = idempotencyKey || null;

    let response;
    try {
      response = await cashCloudRepository.registerCashMovement({
        licenseKey: mode.licenseKey,
        cashSessionId,
        type,
        amount: amountSafe,
        concept: conceptClean,
        idempotencyKey: resolvedIdempotencyKey,
        metadata: {
          ...movementMetadata,
          originActorKey: mode.actor.actorKey,
          cashStationId: station.cashStationId,
          originActorGeneration: actorContext.generation,
          source: movementMetadata.source || movementMetadata.origen || 'manual',
          reference_type: movementMetadata.reference_type || movementMetadata.referenceType || null,
          reference_id: movementMetadata.reference_id || movementMetadata.referenceId || null
        },
        actorHandle: actorContext
      });
    } catch (movementError) {
      const normalized = normalizeCashMutationError(movementError, 'CASH_MOVEMENT_FAILED');
      return fail(normalized.message, normalized.code, { error: normalized });
    }

    if (response?.success === false) {
      return fail(response.message || 'No se pudo registrar el movimiento cloud.', response.code || 'CASH_MOVEMENT_FAILED', { response });
    }

    const applied = await applyFinancialCloudResponse({ response, actorContext });
    invalidateCloudCacheAfterCashMutation(mode.licenseKey);
    posSyncOrchestrator.pullIncremental('cash_movement').catch(() => {});

    actorContext.assertCurrent();
    return {
      success: true,
      cashSession: applied.cashSession,
      movement: applied.movement,
      idempotencyKey: resolvedIdempotencyKey,
      response
    };
  },

  async adjustInitialFund({ cashSessionId, newAmount, reason, expectedVersion = null }) {
    const mode = getCashMode();
    assertCanUseCashRegister();
    const station = await getStationForMode();
    const actorContext = captureFinancialActor();
    if (!mode.cloudEnabled) {
      const idempotencyKey = generateIdempotencyKey({
        entityType: SYNC_ENTITY_TYPES.CASH_SESSION,
        operation: SYNC_OPERATIONS.ADJUST,
        entityId: cashSessionId,
        prefix: 'cash_adjust'
      });
      return cashLocalRepository.adjustInitialFund({
        cashSessionId,
        newAmount,
        reason,
        expectedVersion,
        actorKey: mode.actor.actorKey,
        cashStationId: station.cashStationId,
        actorContext,
        idempotencyKey
      });
    }

    if (!mode.online) {
      showOfflineCashMessage();
      return fail(CASH_CLOUD_OFFLINE_MESSAGE, 'CLOUD_CASH_OFFLINE');
    }

    await assertCurrentFinancialSessionForMutation({
      mode,
      station,
      cashSessionId,
      actorContext,
      operation: 'cash initial fund adjustment'
    });

    let response;
    try {
      response = await cashCloudRepository.adjustInitialCashFund({
        licenseKey: mode.licenseKey,
        cashSessionId,
        newAmount: normalizeAmount(newAmount),
        reason,
        expectedVersion,
        idempotencyKey: null,
        actorHandle: actorContext
      });
    } catch (adjustError) {
      const normalized = normalizeCashMutationError(adjustError, 'CASH_ADJUST_FAILED');
      return fail(normalized.message, normalized.code, { error: normalized });
    }

    if (response?.success === false) {
      return fail(response.message || 'No se pudo ajustar el fondo inicial.', response.code || 'CASH_ADJUST_FAILED', { response });
    }

    const applied = await applyFinancialCloudResponse({ response, actorContext });
    invalidateCloudCacheAfterCashMutation(mode.licenseKey);
    posSyncOrchestrator.pullIncremental('cash_adjust').catch(() => {});
    actorContext.assertCurrent();
    return {
      success: true,
      noChange: Boolean(response?.no_change),
      cashSession: applied.cashSession,
      movement: applied.movement,
      response
    };
  },

  async closeCashSession({ cashSessionId, countedAmount, nextShiftFund, comments = '', expectedVersion = null }) {
    const mode = getCashMode();
    assertCanUseCashRegister();
    const station = await getStationForMode();
    const actorContext = captureFinancialActor();
    if (!mode.cloudEnabled) {
      const idempotencyKey = generateIdempotencyKey({
        entityType: SYNC_ENTITY_TYPES.CASH_SESSION,
        operation: SYNC_OPERATIONS.CLOSE,
        entityId: cashSessionId,
        prefix: 'cash_close'
      });
      return cashLocalRepository.closeCashSession({
        cashSessionId,
        countedAmount,
        nextShiftFund,
        comments,
        expectedVersion,
        actorKey: mode.actor.actorKey,
        cashStationId: station.cashStationId,
        actorContext,
        idempotencyKey
      });
    }

    if (!mode.online) {
      showOfflineCashMessage();
      return fail(CASH_CLOUD_OFFLINE_MESSAGE, 'CLOUD_CASH_OFFLINE');
    }

    await assertCurrentFinancialSessionForMutation({
      mode,
      station,
      cashSessionId,
      actorContext,
      operation: 'cash session close'
    });

    let response;
    try {
      response = await cashCloudRepository.closeCashSession({
        licenseKey: mode.licenseKey,
        cashSessionId,
        closing: localClosingToCloudPayload({
          countedAmount,
          nextShiftFund,
          comments,
          metadata: {
            closed_by_actor_key: mode.actor.actorKey,
            cash_station_id: station.cashStationId,
            origin_actor_key: mode.actor.actorKey
          }
        }),
        expectedVersion,
        idempotencyKey: null,
        actorHandle: actorContext
      });
    } catch (closeError) {
      const normalized = normalizeCashMutationError(closeError, 'CASH_CLOSE_FAILED');
      return fail(normalized.message, normalized.code, { error: normalized });
    }

    if (response?.success === false) {
      return fail(response.message || 'No se pudo cerrar caja cloud.', response.code || 'CASH_CLOSE_FAILED', { response });
    }

    const applied = await applyFinancialCloudResponse({ response, actorContext });
    invalidateCloudCacheAfterCashMutation(mode.licenseKey);
    posSyncOrchestrator.pullIncremental('cash_close').catch(() => {});
    actorContext.assertCurrent();
    return {
      success: true,
      cashSession: applied.cashSession,
      diferencia: applied.cashSession?.diferencia,
      response
    };
  },

  async getCashSessionDetailForAudit({ cashSessionId, force = false }) {
    const mode = getCashMode();
    if (!mode.cloudEnabled || !mode.online) {
      return fail(CASH_CLOUD_OFFLINE_MESSAGE, 'CLOUD_CASH_OFFLINE');
    }
    if (!canAuditCashSessions()) {
      return fail('No tienes permiso para revisar esta caja.', 'CASH_AUDIT_PERMISSION_DENIED');
    }
    const response = await cashCloudRepository.getCashSessionDetailForAudit({
      licenseKey: mode.licenseKey,
      cashSessionId,
      force
    });
    if (response?.success === false) {
      return fail(response.message || 'No se pudo cargar el detalle de caja.', response.code || 'CASH_AUDIT_DETAIL_FAILED', { response });
    }
    const applied = await applyCloudResponse(response);
    return {
      success: true,
      cashSession: applied.cashSession || response.cash_session || null,
      movements: response.movements || [],
      auditEvents: response.audit_events || [],
      response
    };
  },

  async adminCloseCashSession({
    cashSessionId,
    closingMode,
    countedAmount = null,
    nextShiftFund = null,
    reasonCode,
    comments = '',
    expectedVersion,
    idempotencyKey = null
  }) {
    const mode = getCashMode();
    if (!mode.cloudEnabled) {
      return fail('El cierre administrativo solo esta disponible para Caja PRO cloud.', 'ADMIN_CASH_CLOSE_UNAVAILABLE');
    }
    if (!mode.online) {
      showOfflineCashMessage();
      return fail(CASH_CLOUD_OFFLINE_MESSAGE, 'CLOUD_CASH_OFFLINE');
    }
    if (mode.actor.isStaff) {
      return fail('Solo un administrador con sesion valida puede cerrar administrativamente una caja.', 'ADMIN_SESSION_REQUIRED');
    }
    const actorContext = captureFinancialActor();

    const resolvedIdempotencyKey = idempotencyKey || null;
    let response;
    try {
      response = await cashCloudRepository.adminCloseCashSession({
        licenseKey: mode.licenseKey,
        cashSessionId,
        closingMode,
        countedAmount: countedAmount === null ? null : normalizeAmount(countedAmount),
        nextShiftFund: nextShiftFund === null ? null : normalizeAmount(nextShiftFund),
        reasonCode,
        comments,
        expectedVersion,
        idempotencyKey: resolvedIdempotencyKey,
        actorHandle: actorContext
      });
    } catch (adminCloseError) {
      const normalized = normalizeCashMutationError(adminCloseError, 'ADMIN_CASH_CLOSE_FAILED');
      return fail(normalized.message, normalized.code, { error: normalized });
    }
    if (response?.success === false) {
      if (ADMIN_CLOSE_REVIEW_CODES.has(response.code) && response.cash_session) {
        try {
          await applyFinancialCloudResponse({ response, actorContext });
        } catch (projectionError) {
          Logger.warn('No se pudo actualizar la proyección local de la revisión administrativa; se conserva la respuesta del servidor.', projectionError);
        }
      }
      return fail(response.message || 'No se pudo cerrar administrativamente la caja.', response.code || 'ADMIN_CASH_CLOSE_FAILED', { response });
    }
    const applied = await applyFinancialCloudResponse({ response, actorContext });
    invalidateCloudCacheAfterCashMutation(mode.licenseKey);
    posSyncOrchestrator.pullIncremental('cash_admin_close').catch(() => {});
    actorContext.assertCurrent();
    return { success: true, cashSession: applied.cashSession, response };
  },

  async adoptLegacyCashSession({ cashSessionId, expectedVersion = null }) {
    const mode = getCashMode();
    if (!mode.cloudEnabled) {
      return fail('La transición de cajas anteriores solo está disponible en Caja PRO cloud.', 'LEGACY_CASH_ADOPTION_UNAVAILABLE');
    }
    if (!mode.online) {
      showOfflineCashMessage();
      return fail(CASH_CLOUD_OFFLINE_MESSAGE, 'CLOUD_CASH_OFFLINE');
    }
    if (mode.actor.isStaff) {
      return fail('Solo un administrador con sesión válida puede continuar una caja anterior.', 'ADMIN_SESSION_REQUIRED');
    }

    const idempotencyKey = generateIdempotencyKey({
      entityType: SYNC_ENTITY_TYPES.CASH_SESSION,
      operation: 'identity_adopt',
      entityId: cashSessionId,
      prefix: 'cash_identity_adopt'
    });
    const response = await cashCloudRepository.adoptLegacyCashSession({
      licenseKey: mode.licenseKey,
      cashSessionId,
      expectedVersion,
      idempotencyKey
    });
    if (response?.success === false) {
      return fail(response.message || 'No se pudo continuar la caja anterior.', response.code || 'LEGACY_CASH_ADOPTION_FAILED', { response });
    }
    const applied = await applyCloudResponse(response);
    invalidateCloudCacheAfterCashMutation(mode.licenseKey);
    posSyncOrchestrator.pullIncremental('cash_identity_adopt').catch(() => {});
    return { success: true, cashSession: applied.cashSession, response };
  },

  async pullCashSnapshot({ scope = 'mine', includeClosed = true, limit = 100, offset = 0, force = false } = {}) {
    const mode = getCashMode();

    if (!mode.cloudEnabled || !mode.online) {
      const cashSessions = await cashLocalRepository.getHistory({
        actorKey: mode.actor.actorKey,
        staffUserId: mode.actor.staffUserId,
        isAdmin: false,
        includeAll: scope === 'all' && !mode.actor.isStaff,
        limit
      });
      return { success: true, cashSessions, movements: [], readOnly: mode.readOnly };
    }

    const response = await cashCloudRepository.pullCashSnapshot({
      licenseKey: mode.licenseKey,
      scope,
      includeClosed,
      limit,
      offset,
      force
    });

    if (response?.success === false) {
      return fail(response.message || 'No se pudo refrescar caja cloud.', response.code || 'CASH_SNAPSHOT_FAILED', { response });
    }

    const applied = await applyCloudResponse(response);
    return {
      success: true,
      cashSessions: applied.cashSessions,
      movements: applied.movements,
      latestChangeSeq: response.latest_change_seq,
      response
    };
  },

  async listCashSessionsForAudit(filters = {}) {
    const mode = getCashMode();
    if (!mode.cloudEnabled || !mode.online || !canAuditCashSessions()) {
      const cashSessions = await cashLocalRepository.getHistory({
        actorKey: mode.actor.actorKey,
        staffUserId: mode.actor.staffUserId,
        isAdmin: false,
        includeAll: !mode.actor.isStaff,
        limit: filters.limit || 100
      });
      return { success: true, cashSessions, readOnly: mode.readOnly };
    }

    const response = await cashCloudRepository.listCashSessionsForAudit({
      licenseKey: mode.licenseKey,
      ...filters
    });

    if (response?.success === false) {
      return fail(response.message || 'No se pudo cargar auditoría de caja.', response.code || 'CASH_AUDIT_FAILED', { response });
    }

    const applied = await applyCloudResponse(response);
    return { success: true, cashSessions: applied.cashSessions, response };
  }
};

export default cashRepository;
