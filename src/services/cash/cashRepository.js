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
import { cashLocalRepository } from './cashLocalRepository';
import { getCashStationIdentity } from './cashStation';
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

const normalizeAmount = (value) => Money.toExactString(Money.init(value || 0));

const showOfflineCashMessage = () => {
  showMessageModal(CASH_CLOUD_OFFLINE_MESSAGE, null, { type: 'warning' });
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
    stationResolved: Boolean(station?.cashStationId)
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
    cashSession: cashSession || result?.cashSession || null
  };
};

const assertResponseOwnSession = (response, mode) => {
  const session = response?.cash_session || response?.cashSession || null;
  const owner = session?.actor_key || session?.actorKey || null;
  if (session && owner && owner !== mode.actor.actorKey) {
    throw new CashFinancialError(CASH_FINANCIAL_CODES.HANDOFF_REQUIRED, 'La respuesta cloud contiene una sesión de otro actor.', {
      ownerActorKey: owner,
      actorKey: mode.actor.actorKey
    });
  }
  return session;
};

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
    stateKnown: current.stateKnown !== false
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

  if (response.cash_session) {
    applied.cashSession = await cashLocalRepository.applyCloudCashSession(response.cash_session);
  }

  if (response.movement) {
    applied.movement = await cashLocalRepository.applyCloudCashMovement(response.movement);
  }

  if (Array.isArray(response.cash_sessions)) {
    applied.cashSessions = await cashLocalRepository.applyCloudCashSessions(response.cash_sessions);
  }

  if (Array.isArray(response.movements)) {
    applied.movements = await cashLocalRepository.applyCloudCashMovements(response.movements);
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

const getCachedScope = async (mode, { limit = 50 } = {}) => {
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
    stateKnown: !mode.cloudEnabled
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
    financialCode: financial.code
    }
  });
};

export const cashRepository = {
  getMode: getCashMode,

  async getCurrentCashSession({ force = false } = {}) {
    const mode = getCashMode();
    let station = null;
    try {
      station = await getStationForMode();
    } catch (stationError) {
      Logger.warn('[Cash] Estación financiera no resuelta:', stationError);
    }

    if (!mode.cloudEnabled) {
      return getCachedScope({ ...mode, readOnly: false });
    }

    if (!mode.online) {
      return getCachedScope(mode);
    }

    assertCanUseCashRegister();

    try {
      const response = await cashCloudRepository.getCurrentCashSession({ licenseKey: mode.licenseKey, force });
      if (response?.success === false) {
        return fail(response.message || 'No se pudo cargar la caja cloud.', response.code || 'CASH_CURRENT_FAILED', { response });
      }

      const stationState = await cashCloudRepository.getCashStationState({
        licenseKey: mode.licenseKey,
        force
      });
      if (stationState?.success === false || !stationState?.cash_station) {
        throw new CashFinancialError(
          stationState?.code || CASH_FINANCIAL_CODES.STATION_UNRESOLVED,
          stationState?.message || 'No se pudo verificar la estación financiera.',
          { stationState }
        );
      }
      const currentSession = assertResponseOwnSession(response, mode);
      const stationOpenCashSession = stationState?.station_open_cash_session
        || stationState?.stationOpenCashSession
        || null;

      const applied = await applyCloudResponse(response);
      if (stationOpenCashSession && stationOpenCashSession.id !== currentSession?.id) {
        await cashLocalRepository.applyCloudCashSession(stationOpenCashSession);
      }
      const cashSession = applied.cashSession && (
        (applied.cashSession.actorKey || response.actor_key) === mode.actor.actorKey
      ) ? applied.cashSession : null;
      const projection = cashSession
        ? await cashLocalRepository.loadProjection(cashSession)
        : { movements: [], totals: { ventasContado: '0', abonosFiado: '0' } };

      let cashSessions = [];
      try {
        const snapshot = await this.pullCashSnapshot({ scope: mode.actor.isStaff ? 'mine' : 'all', includeClosed: true, limit: 50, force });
        cashSessions = snapshot.cashSessions || [];
      } catch (snapshotError) {
        Logger.warn('[Cash] Snapshot posterior a current fallo:', snapshotError);
        cashSessions = await cashLocalRepository.getHistory({
          actorKey: mode.actor.actorKey,
          staffUserId: mode.actor.staffUserId,
          isAdmin: !mode.actor.isStaff,
          limit: 50
        });
      }

      return buildFinancialResult({
        mode,
        station: (stationState?.cash_station ? {
          cashStationId: stationState.cash_station.id,
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
      Logger.warn('[Cash] Carga cloud falló; cache local queda read-only y no libre:', normalized);
      const cached = await getCachedScope({ ...mode, readOnly: true });
      return {
        ...cached,
        success: true,
        warning: normalized.message || 'No se pudo refrescar caja cloud.',
        readOnly: true,
        financialStatus: cached.financialStatus === CASH_FINANCIAL_STATUS.NO_SESSION
          ? CASH_FINANCIAL_STATUS.BLOCKED
          : cached.financialStatus,
        financialCode: cached.financialCode || CASH_FINANCIAL_CODES.HANDOFF_REQUIRES_ONLINE,
        stateKnown: false
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
