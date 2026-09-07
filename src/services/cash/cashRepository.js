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
  CASH_STATION_IDENTITY_STATE,
  getCashStationIdFromCloudResponse,
  getCashStationIdentity,
  isCanonicalCashStation,
  persistCashStationBinding
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

const getStationForMode = async (mode = null) => getCashStationIdentity({
  licenseKey: mode?.licenseKey || null
});

const buildCashReadCacheContext = (mode, station) => ({
  actorKey: mode?.actor?.actorKey || null,
  actorSessionId: mode?.actor?.sessionId
    || mode?.actor?.actorSessionId
    || mode?.actor?.staffSessionId
    || null,
  deviceFingerprint: station?.deviceFingerprint || null,
  localStationKey: station?.localStationKey || null,
  cashStationId: isCanonicalCashStation(station?.cashStationId)
    ? station.cashStationId
    : null
});

const redactCashIdentity = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) return null;

  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `redacted:${(hash >>> 0).toString(36)}`;
};

const getCloudRequestMetadata = (value) => value?.cloudRequestMeta
  || value?.cause?.cloudRequestMeta
  || value?.details?.cloudRequestMeta
  || null;

const buildCashResponseDiagnostic = ({
  error = null,
  response = null,
  localStation = null,
  cloudStationId = null
} = {}) => {
  const metadata = getCloudRequestMetadata(error) || getCloudRequestMetadata(response);
  return {
    code: error?.code || null,
    requestId: error?.requestId || metadata?.requestId || null,
    generation: error?.generation ?? metadata?.generation ?? null,
    origin: error?.responseOrigin || error?.origin || metadata?.origin || null,
    localStation: redactCashIdentity(localStation?.localStationKey),
    cloudStation: redactCashIdentity(
      cloudStationId || getCashStationIdFromCloudResponse(response || {})
    )
  };
};

const logCashResponseOrigin = ({ response, localStation, cloudStationId = null } = {}) => {
  const metadata = getCloudRequestMetadata(response);
  if (!metadata || typeof Logger.debug !== 'function') return;
  Logger.debug('[Cash] Respuesta de verificación cloud:', buildCashResponseDiagnostic({
    response,
    localStation,
    cloudStationId
  }));
};

const logCashNetworkUnavailableOnce = (error, context = {}) => {
  if (cashNetworkWarningActive) return;
  cashNetworkWarningActive = true;
  Logger.warn('[Cash] Sin conexión con Supabase; la cache local queda en solo consulta:',
    buildCashResponseDiagnostic({ error, ...context }));
};

const assertAuthoritativeCashResponse = (response, label) => {
  const metadata = getCloudRequestMetadata(response);
  if (metadata?.origin === 'cache') {
    throw new CashFinancialError(
      'CASH_CLOUD_RESPONSE_NOT_AUTHORITATIVE',
      `La respuesta cloud de ${label} proviene de cache y no puede validar el estado financiero actual.`,
      {
        responseOrigin: metadata.origin,
        requestId: metadata.requestId,
        generation: metadata.generation
      }
    );
  }
  return metadata;
};

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
  const cashStationId = mode.cloudEnabled && isCanonicalCashStation(station?.cashStationId)
    ? station.cashStationId
    : null;
  const localStationKey = mode.cloudEnabled ? null : station?.localStationKey || null;
  const resultCashStationId = isCanonicalCashStation(result?.cashStationId)
    ? result.cashStationId
    : null;
  const resultLocalStationKey = result?.localStationKey && !isCanonicalCashStation(result.localStationKey)
    ? result.localStationKey
    : null;
  const state = deriveCashFinancialState({
    actorKey: mode.actor.actorKey,
    cashSession,
    stationOpenCashSession,
    cashStationId,
    localStationKey,
    online: mode.online,
    cloudEnabled: mode.cloudEnabled,
    stateKnown: result?.stateKnown !== false,
    stationResolved: mode.cloudEnabled ? Boolean(cashStationId) : Boolean(localStationKey),
    networkUnavailable: Boolean(result?.networkUnavailable)
  });
  return {
    ...result,
    financialStatus: state.status === CASH_FINANCIAL_STATUS.HANDOFF_REQUIRED || state.status === CASH_FINANCIAL_STATUS.BLOCKED
      ? state.status
      : (result?.financialStatus || state.status),
    financialCode: state.code || result?.financialCode || null,
    financialState: state,
    cashStationId: cashStationId || (mode.cloudEnabled ? null : resultCashStationId),
    localStationKey: localStationKey || resultLocalStationKey,
    stationOpenCashSession: stationOpenCashSession || result?.stationOpenCashSession || null,
    cashSession: cashSession || result?.cashSession || null,
    networkUnavailable: Boolean(result?.networkUnavailable)
  };
};

const getSessionStationId = (session) => [
  session?.cash_station_id,
  session?.cashStationId,
  session?.metadata?.cash_station_id,
  session?.metadata?.cashStationId
].find((value) => isCanonicalCashStation(value)) || null;

const withStationEvidence = (session, cashStationId) => (
  session && !getSessionStationId(session) && cashStationId
    ? { ...session, cash_station_id: cashStationId }
    : session
);

const assertSessionForStation = (
  session,
  cashStationId,
  message = 'La respuesta cloud contiene una sesión de otra estación.',
  cloudRequestMeta = null
) => {
  if (!session || !cashStationId) return session;
  const sessionWithEvidence = withStationEvidence(session, cashStationId);
  const sessionStationId = getSessionStationId(sessionWithEvidence);
  if (!areCashStationsEquivalent(sessionStationId, cashStationId)) {
    throw new CashFinancialError(CASH_FINANCIAL_CODES.STATION_MISMATCH, message, {
      sessionStationId,
      cashStationId,
      cloudRequestMeta
    });
  }
  return sessionWithEvidence;
};

const assertResponseOwnSession = (response, mode, cashStationId = null) => {
  const session = response?.cash_session || response?.cashSession || null;
  const cloudRequestMeta = getCloudRequestMetadata(response);
  const responseActor = response?.actor_key || response?.actorKey || null;
  if (responseActor && responseActor !== mode.actor.actorKey) {
    throw new CashFinancialError(CASH_FINANCIAL_CODES.HANDOFF_REQUIRED, 'La respuesta cloud pertenece a otro actor.', {
      responseActorKey: responseActor,
      actorKey: mode.actor.actorKey,
      cloudRequestMeta
    });
  }
  const owner = session?.actor_key || session?.actorKey || null;
  if (session && owner !== mode.actor.actorKey) {
    throw new CashFinancialError(CASH_FINANCIAL_CODES.HANDOFF_REQUIRED, 'La respuesta cloud contiene una sesión de otro actor.', {
      ownerActorKey: owner,
      actorKey: mode.actor.actorKey,
      cloudRequestMeta
    });
  }
  const responseStationId = getCashStationIdFromCloudResponse(response);
  if (responseStationId && cashStationId && !areCashStationsEquivalent(responseStationId, cashStationId)) {
    throw new CashFinancialError(CASH_FINANCIAL_CODES.STATION_MISMATCH, 'La respuesta cloud contiene una estación de otra estación.', {
      responseStationId,
      cashStationId,
      cloudRequestMeta
    });
  }
  return assertSessionForStation(
    session,
    responseStationId || cashStationId,
    undefined,
    cloudRequestMeta
  );
};

const assertCloudResponseStation = ({ response } = {}) => {
  const cloudRequestMeta = getCloudRequestMetadata(response);
  const serverCashStationId = getCashStationIdFromCloudResponse(response);
  if (!serverCashStationId || !isCanonicalCashStation(serverCashStationId)) {
    throw new CashFinancialError(
      CASH_FINANCIAL_CODES.STATION_UNRESOLVED,
      'La respuesta cloud no contiene una estación financiera canónica.',
      { response, cloudRequestMeta }
    );
  }

  const resolvedCashStationId = response?.resolvedCashStationId || null;
  if (resolvedCashStationId && !areCashStationsEquivalent(serverCashStationId, resolvedCashStationId)) {
    throw new CashFinancialError(
      CASH_FINANCIAL_CODES.STATION_MISMATCH,
      'La respuesta cloud contiene una estación financiera inconsistente.',
      { serverCashStationId, resolvedCashStationId, cloudRequestMeta }
    );
  }

  const session = response?.cash_session || response?.cashSession || null;
  if (session) assertSessionForStation(session, serverCashStationId, undefined, cloudRequestMeta);
  return serverCashStationId;
};

const persistCloudCashStationBinding = ({ mode, station, response, cashStationId = null } = {}) => {
  const resolvedCashStationId = cashStationId || getCashStationIdFromCloudResponse(response || {});
  if (!mode?.licenseKey || !station?.deviceFingerprint || !isCanonicalCashStation(resolvedCashStationId)) return false;

  try {
    return persistCashStationBinding({
      licenseKey: mode.licenseKey,
      deviceFingerprint: station.deviceFingerprint,
      cashStationId: resolvedCashStationId,
      deviceId: response?.cash_station?.device_id
        || response?.cashStation?.device_id
        || response?.device_id
        || station.deviceId
        || null,
      stationKey: response?.cash_station?.station_key
        || response?.cashStation?.station_key
        || response?.cash_station?.stationKey
        || response?.cashStation?.stationKey
        || station.stationKey
        || null,
      bindingMode: response?.cash_station?.binding_mode
        || response?.cashStation?.bindingMode
        || station.bindingMode
        || 'device'
    });
  } catch (error) {
    Logger.warn('[Cash] No se pudo persistir la vinculación local de estación:', {
      code: error?.code || 'CASH_STATION_BINDING_PERSIST_FAILED'
    });
    return false;
  }
};

export const cashRepositoryInternals = Object.freeze({
  assertSessionForStation,
  assertResponseOwnSession,
  assertCloudResponseStation,
  assertAuthoritativeCashResponse,
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
    cashStationId: isCanonicalCashStation(current.cashStationId)
      ? current.cashStationId
      : (isCanonicalCashStation(station?.cashStationId) ? station.cashStationId : null),
    online: mode.online,
    cloudEnabled: mode.cloudEnabled,
    stateKnown: current.stateKnown !== false,
    networkUnavailable: current.networkUnavailable === true
  });
  return assertCashFinancialWriteAccess({
    state,
    cashSessionId,
    actorKey: mode.actor.actorKey,
    cashStationId: isCanonicalCashStation(current.cashStationId)
      ? current.cashStationId
      : (isCanonicalCashStation(station?.cashStationId) ? station.cashStationId : null),
    operation
  });
};

const assertCloudCashStateKnownBeforeOpen = async ({ mode, station } = {}) => {
  // Partial repository doubles in contract tests do not expose the read API;
  // the production repository always does. Keeping this guard at the write
  // boundary prevents a direct cloud open from bypassing Caja's read-only
  // state after a transport failure.
  if (typeof cashCloudRepository.getCurrentCashSession !== 'function'
    || typeof cashCloudRepository.getCashStationState !== 'function') return null;

  let current;
  try {
    current = await cashCloudRepository.getCurrentCashSession({
      licenseKey: mode.licenseKey,
      force: true,
      cacheContext: buildCashReadCacheContext(mode, station),
      allowCache: false
    });
  } catch (error) {
    if (isCashNetworkUnavailableError(error)) {
      throw new CashFinancialError(
        CASH_NETWORK_UNAVAILABLE_CODE,
        CASH_NETWORK_UNAVAILABLE_MESSAGE,
        { cause: normalizeCashNetworkError(error, { rpcName: 'pos_get_current_cash_session' }) }
      );
    }
    throw error;
  }
  if (current?.success === false) {
    throw new CashFinancialError(
      current.code || CASH_FINANCIAL_CODES.SESSION_REQUIRED,
      current.message || 'No se pudo verificar el estado financiero antes de abrir caja.',
      { current }
    );
  }
  if (current?.networkUnavailable || current?.stateKnown === false || current?.readOnly
    || current?.financialStatus === CASH_FINANCIAL_STATUS.BLOCKED
    || current?.financialStatus === CASH_FINANCIAL_STATUS.HANDOFF_REQUIRED) {
    throw new CashFinancialError(
      current.financialCode || (current.networkUnavailable
        ? CASH_NETWORK_UNAVAILABLE_CODE
        : CASH_FINANCIAL_CODES.HANDOFF_REQUIRES_ONLINE),
      current.warning || 'La apertura permanece bloqueada hasta verificar nuevamente la Caja.',
      { current }
    );
  }

  let stationState;
  try {
    stationState = await cashCloudRepository.getCashStationState({
      licenseKey: mode.licenseKey,
      force: true,
      cacheContext: buildCashReadCacheContext(mode, station),
      allowCache: false
    });
  } catch (error) {
    if (isCashNetworkUnavailableError(error)) {
      throw new CashFinancialError(
        CASH_NETWORK_UNAVAILABLE_CODE,
        CASH_NETWORK_UNAVAILABLE_MESSAGE,
        { cause: normalizeCashNetworkError(error, { rpcName: 'pos_get_cash_station_state' }) }
      );
    }
    throw error;
  }
  if (stationState?.success === false || !stationState?.cash_station) {
    throw new CashFinancialError(
      isCashNetworkUnavailableError(stationState)
        ? CASH_NETWORK_UNAVAILABLE_CODE
        : (stationState?.code || CASH_FINANCIAL_CODES.STATION_UNRESOLVED),
      stationState?.message || 'No se pudo verificar la estación financiera antes de abrir caja.',
      { stationState }
    );
  }

  assertAuthoritativeCashResponse(current, 'la sesión actual antes de abrir caja');
  assertAuthoritativeCashResponse(stationState, 'el estado de estación antes de abrir caja');
  const stationId = assertCloudResponseStation({ response: stationState, localStation: station });
  const currentSession = assertResponseOwnSession(current, mode, stationId);
  const stationOpenCashSession = assertSessionForStation(
    stationState.station_open_cash_session || stationState.stationOpenCashSession || null,
    stationId,
    undefined,
    getCloudRequestMetadata(stationState)
  );
  if (currentSession && !isCompleteCloudCashSession(currentSession)) {
    throw new CashFinancialError(
      'CASH_CURRENT_RESPONSE_INVALID',
      'La respuesta cloud no contiene una sesión de caja completa antes de abrir caja.',
      { current }
    );
  }
  if (stationOpenCashSession && !isCompleteCloudCashSession(stationOpenCashSession)) {
    throw new CashFinancialError(
      'CASH_STATION_STATE_INVALID',
      'La respuesta cloud no contiene una sesión de estación completa antes de abrir caja.',
      { stationState }
    );
  }
  const stationOwner = stationOpenCashSession?.actor_key || stationOpenCashSession?.actorKey || null;
  if (stationOwner && stationOwner !== mode.actor.actorKey) {
    throw new CashFinancialError(
      CASH_FINANCIAL_CODES.HANDOFF_REQUIRED,
      'La estación financiera requiere cierre y reconciliación antes de cambiar de actor.',
      { stationOpenCashSession, stationId }
    );
  }
  persistCloudCashStationBinding({
    mode,
    station,
    response: current,
    cashStationId: getCashStationIdFromCloudResponse(current)
  });
  persistCloudCashStationBinding({ mode, station, response: stationState, cashStationId: stationId });
  return { current, stationState, cashStationId: stationId };
};

const assertCloudStationKnownBeforeWrite = async ({ mode, station, operation } = {}) => {
  if (typeof cashCloudRepository.getCashStationState !== 'function') return null;

  const stationState = await cashCloudRepository.getCashStationState({
    licenseKey: mode.licenseKey,
    force: true,
    cacheContext: buildCashReadCacheContext(mode, station),
    allowCache: false
  });
  if (stationState?.success === false || !stationState?.cash_station) {
    const networkUnavailable = isCashNetworkUnavailableError(stationState);
    throw new CashFinancialError(
      networkUnavailable
        ? CASH_NETWORK_UNAVAILABLE_CODE
        : (stationState?.code || CASH_FINANCIAL_CODES.STATION_UNRESOLVED),
      stationState?.message || `${operation || 'La operación'} requiere verificar la estación financiera.`,
      { stationState }
    );
  }
  assertAuthoritativeCashResponse(stationState, 'el estado de estación');
  const stationId = assertCloudResponseStation({ response: stationState, localStation: station });
  persistCloudCashStationBinding({ mode, station, response: stationState, cashStationId: stationId });
  return stationState;
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
    return {
      ...record,
      cash_station_id: serverCashStationId,
      cashStationId: serverCashStationId,
      localStationKey: null
    };
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
    const validSession = validCashSession(response.cash_session);
    if (validSession) {
      applied.cashSession = await cashLocalRepository.applyCloudCashSession(validSession);
    }
  }

  if (response.movement !== undefined && response.movement !== null) {
    const validMovement = validCashMovement(response.movement);
    if (validMovement) {
      applied.movement = await cashLocalRepository.applyCloudCashMovement(validMovement);
    }
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
    station = await getStationForMode(mode);
  } catch (stationError) {
    Logger.warn('[Cash] No se pudo resolver la estación local:', {
      code: stationError?.code || 'CASH_STATION_UNRESOLVED'
    });
  }
  const financial = await cashLocalRepository.getFinancialState({
    actorKey: actor.actorKey,
    cashStationId: mode.cloudEnabled && isCanonicalCashStation(station?.cashStationId)
      ? station.cashStationId
      : null,
    localStationKey: mode.cloudEnabled ? null : station?.localStationKey || null,
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

  invalidateCashReadGenerations() {
    return cashCloudRepository.invalidateCashReadGenerations?.() || 0;
  },

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
      station = await getStationForMode(mode);
    } catch (stationError) {
      Logger.warn('[Cash] Estación financiera no resuelta:', {
        code: stationError?.code || 'CASH_STATION_UNRESOLVED'
      });
    }

    assertCanUseCashRegister();
    const cashReadCacheContext = buildCashReadCacheContext(mode, station);

    try {
      const response = await cashCloudRepository.getCurrentCashSession({
        licenseKey: mode.licenseKey,
        force,
        cacheContext: cashReadCacheContext,
        allowCache: false
      });
      logCashResponseOrigin({ response, localStation: station });
      assertAuthoritativeCashResponse(response, 'la sesión actual');
      if (response?.success === false) {
        if (isCashNetworkUnavailableError(response)) {
          throw normalizeCashNetworkError(response, { rpcName: 'pos_get_current_cash_session' });
        }
        return fail(response.message || 'No se pudo cargar la caja cloud.', response.code || 'CASH_CURRENT_FAILED', { response });
      }

      const stationState = await cashCloudRepository.getCashStationState({
        licenseKey: mode.licenseKey,
        force,
        cacheContext: cashReadCacheContext,
        allowCache: false
      });
      logCashResponseOrigin({
        response: stationState,
        localStation: station,
        cloudStationId: getCashStationIdFromCloudResponse(stationState)
      });
      assertAuthoritativeCashResponse(stationState, 'el estado de estación');
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

      // Both authenticated read RPCs carry server station evidence. Persist
      // only after the two responses agree and their sessions pass actor and
      // station validation, so an inconsistent response cannot poison the
      // tenant-scoped browser binding.
      persistCloudCashStationBinding({
        mode,
        station,
        response,
        cashStationId: getCashStationIdFromCloudResponse(response)
      });
      persistCloudCashStationBinding({ mode, station, response: stationState, cashStationId: stationId });

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
        const snapshot = await this.pullCashSnapshot({
          scope: mode.actor.isStaff ? 'mine' : 'all',
          includeClosed: true,
          limit: 50,
          force,
          cacheContext: cashReadCacheContext,
          allowCache: false
        });
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
          ...station,
          cashStationId: stationId,
          deviceId: stationState.cash_station.device_id || station?.deviceId || null,
          stationKey: stationState.cash_station.station_key
            || stationState.cash_station.stationKey
            || station?.stationKey
            || null,
          identityState: CASH_STATION_IDENTITY_STATE.CANONICAL
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
      const networkUnavailable = isCashNetworkUnavailableError(error);
      const normalized = networkUnavailable
        ? normalizeCashNetworkError(error, { rpcName: error?.rpcName || 'cash_verification' })
        : normalizeCashMutationError(error, 'CASH_CURRENT_FAILED');
      if (networkUnavailable) {
        logCashNetworkUnavailableOnce(normalized, {
          response: error?.response || error?.details?.response || null,
          localStation: station,
          cloudStationId: error?.details?.serverCashStationId
            || error?.details?.responseStationId
            || error?.details?.sessionStationId
            || null
        });
      } else {
        Logger.warn('[Cash] Carga cloud falló; cache local queda read-only y no libre:',
          buildCashResponseDiagnostic({
            error: normalized,
            response: error?.details?.response || null,
            localStation: station,
            cloudStationId: error?.details?.serverCashStationId
              || error?.details?.responseStationId
              || error?.details?.sessionStationId
              || null
          }));
      }
      const cached = networkUnavailable
        ? await buildNetworkUnavailableScope(mode)
        : await getSafeCachedScope({ ...mode, readOnly: true }, { networkUnavailable: false });
      const safeFinancialCode = networkUnavailable
        ? CASH_NETWORK_UNAVAILABLE_CODE
        : (normalized.code || cached.financialCode || CASH_FINANCIAL_CODES.HANDOFF_REQUIRES_ONLINE);
      return {
        ...cached,
        success: true,
        warning: networkUnavailable
          ? CASH_NETWORK_UNAVAILABLE_MESSAGE
          : (normalized.message || 'No se pudo refrescar caja cloud.'),
        readOnly: true,
        financialStatus: CASH_FINANCIAL_STATUS.BLOCKED,
        financialCode: safeFinancialCode,
        stateKnown: false,
        networkUnavailable,
        financialState: {
          ...(cached.financialState || {}),
          status: CASH_FINANCIAL_STATUS.BLOCKED,
          code: safeFinancialCode,
          stateKnown: false,
          networkUnavailable,
          online: mode.online,
          cloudEnabled: mode.cloudEnabled
        }
      };
    }
  },

  async openCashSession(openingData) {
    const mode = getCashMode();
    assertCanUseCashRegister();
    const station = await getStationForMode(mode);
    const actorContext = captureFinancialActor();
    const canonicalOpeningData = {
      ...openingData,
      actorKey: mode.actor.actorKey,
      originActorKey: mode.actor.actorKey,
      actorGeneration: actorContext.generation,
      deviceId: station.deviceId,
      deviceFingerprint: station.deviceFingerprint,
      localStationKey: station.localStationKey,
      deviceRole: mode.actor.deviceRole,
      cashStationId: isCanonicalCashStation(station.cashStationId)
        ? station.cashStationId
        : null,
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

    try {
      await assertCloudCashStateKnownBeforeOpen({ mode, station });
    } catch (openVerificationError) {
      const normalized = normalizeCashMutationError(openVerificationError, 'CASH_OPEN_VERIFICATION_REQUIRED');
      return fail(normalized.message, normalized.code, { error: normalized });
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
      persistCloudCashStationBinding({ mode, station, response, cashStationId: serverCashStationId });
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
    const station = await getStationForMode(mode);
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
        cashStationId: null,
        localStationKey: station.localStationKey,
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
          cashStationId: isCanonicalCashStation(station.cashStationId)
            ? station.cashStationId
            : null,
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
    const station = await getStationForMode(mode);
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
        cashStationId: null,
        localStationKey: station.localStationKey,
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
    const station = await getStationForMode(mode);
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
        cashStationId: null,
        localStationKey: station.localStationKey,
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
            cash_station_id: isCanonicalCashStation(station.cashStationId)
              ? station.cashStationId
              : null,
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
    let station = null;
    try {
      station = await getStationForMode(mode);
    } catch {
      // The cloud response remains subject to its actor/device auth checks.
    }
    const response = await cashCloudRepository.getCashSessionDetailForAudit({
      licenseKey: mode.licenseKey,
      cashSessionId,
      force,
      cacheContext: buildCashReadCacheContext(mode, station)
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
    const station = await getStationForMode(mode);
    const actorContext = captureFinancialActor();

    try {
      await assertCloudStationKnownBeforeWrite({
        mode,
        station,
        operation: 'El cierre administrativo'
      });
    } catch (verificationError) {
      const normalized = normalizeCashMutationError(verificationError, 'ADMIN_CASH_CLOSE_VERIFICATION_REQUIRED');
      return fail(normalized.message, normalized.code, { error: normalized });
    }

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

    const station = await getStationForMode(mode);
    try {
      await assertCloudStationKnownBeforeWrite({
        mode,
        station,
        operation: 'La transición de caja anterior'
      });
    } catch (verificationError) {
      const normalized = normalizeCashMutationError(verificationError, 'CASH_LEGACY_VERIFICATION_REQUIRED');
      return fail(normalized.message, normalized.code, { error: normalized });
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

  async pullCashSnapshot({
    scope = 'mine',
    includeClosed = true,
    limit = 100,
    offset = 0,
    force = false,
    cacheContext = null,
    allowCache = false
  } = {}) {
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

    let station = null;
    try {
      station = await getStationForMode(mode);
    } catch {
      // The request will still carry license/device/staff context.
    }
    const response = await cashCloudRepository.pullCashSnapshot({
      licenseKey: mode.licenseKey,
      scope,
      includeClosed,
      limit,
      offset,
      force,
      cacheContext: cacheContext || buildCashReadCacheContext(mode, station),
      allowCache
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

    let station = null;
    try {
      station = await getStationForMode(mode);
    } catch {
      // Keep the audit request bound to its authenticated device context.
    }
    const response = await cashCloudRepository.listCashSessionsForAudit({
      licenseKey: mode.licenseKey,
      cacheContext: buildCashReadCacheContext(mode, station),
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
