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
import {
  CASH_CLOUD_OFFLINE_MESSAGE,
  getCashMode
} from './cashActor';
import { assertCanUseCashRegister, canAuditCashSessions } from './cashPermissions';
import {
  localClosingToCloudPayload,
  localOpeningToCloudPayload
} from './cashMapper';

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

const getCachedScope = async (mode, { limit = 50 } = {}) => {
  const actor = mode.actor;
  const isAdmin = !actor.isStaff;
  const cashSession = await cashLocalRepository.getCurrentCashSession({
    actorKey: actor.actorKey,
    staffUserId: actor.staffUserId,
    isAdmin
  });
  const projection = cashSession
    ? await cashLocalRepository.loadProjection(cashSession)
    : { movements: [], totals: { ventasContado: '0', abonosFiado: '0' } };
  const cashSessions = await cashLocalRepository.getHistory({
    actorKey: actor.actorKey,
    staffUserId: actor.staffUserId,
    isAdmin,
    limit
  });

  return {
    success: true,
    readOnly: mode.readOnly,
    cashSession,
    movements: projection.movements,
    totals: projection.totals,
    cashSessions,
    actor,
    mode
  };
};

export const cashRepository = {
  getMode: getCashMode,

  async getCurrentCashSession() {
    const mode = getCashMode();

    if (!mode.cloudEnabled) {
      return getCachedScope({ ...mode, readOnly: false });
    }

    if (!mode.online) {
      return getCachedScope(mode);
    }

    assertCanUseCashRegister();

    try {
      const response = await cashCloudRepository.getCurrentCashSession({ licenseKey: mode.licenseKey });
      if (response?.success === false) {
        return fail(response.message || 'No se pudo cargar la caja cloud.', response.code || 'CASH_CURRENT_FAILED', { response });
      }

      const applied = await applyCloudResponse(response);
      const cashSession = applied.cashSession;
      const projection = cashSession
        ? await cashLocalRepository.loadProjection(cashSession)
        : { movements: [], totals: { ventasContado: '0', abonosFiado: '0' } };

      let cashSessions = [];
      try {
        const snapshot = await this.pullCashSnapshot({ scope: mode.actor.isStaff ? 'mine' : 'all', includeClosed: true, limit: 50 });
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

      return {
        success: true,
        readOnly: false,
        cashSession,
        movements: projection.movements,
        totals: projection.totals,
        cashSessions,
        adminOpenSessions: response.admin_open_sessions || [],
        actor: {
          ...mode.actor,
          actorKey: response.actor_key || mode.actor.actorKey,
          responsibleName: response.actor_name || mode.actor.responsibleName,
          displayName: response.actor_name || mode.actor.displayName
        },
        mode,
        response
      };
    } catch (error) {
      Logger.warn('[Cash] Carga cloud falló, usando cache local read-only:', error);
      const cached = await getCachedScope({ ...mode, readOnly: true });
      return {
        ...cached,
        success: true,
        warning: error?.message || 'No se pudo refrescar caja cloud.',
        readOnly: true
      };
    }
  },

  async openCashSession(openingData) {
    const mode = getCashMode();
    assertCanUseCashRegister();

    if (!mode.cloudEnabled) {
      const cashSession = await cashLocalRepository.openCashSession(openingData);
      return { success: true, cashSession };
    }

    if (!mode.online) {
      showOfflineCashMessage();
      return fail(CASH_CLOUD_OFFLINE_MESSAGE, 'CLOUD_CASH_OFFLINE');
    }

    const idempotencyKey = generateIdempotencyKey({
      entityType: SYNC_ENTITY_TYPES.CASH_SESSION,
      operation: SYNC_OPERATIONS.OPEN,
      entityId: 'current',
      prefix: 'cash_open'
    });

    const response = await cashCloudRepository.openCashSession({
      licenseKey: mode.licenseKey,
      opening: localOpeningToCloudPayload(openingData),
      idempotencyKey
    });

    if (response?.cash_session) {
      const applied = await applyCloudResponse(response);
      invalidateCloudCacheAfterCashMutation(mode.licenseKey);
      posSyncOrchestrator.pullIncremental('cash_open').catch(() => {});
      return {
        success: response.success !== false || response.code === 'CASH_SESSION_ALREADY_OPEN',
        cashSession: applied.cashSession,
        response
      };
    }

    return response?.success === false
      ? fail(response.message || 'No se pudo abrir caja cloud.', response.code || 'CASH_OPEN_FAILED', { response })
      : { success: true, response };
  },

  async registerMovement({ cashSessionId, type, amount, concept, metadata = {} }) {
    const mode = getCashMode();
    assertCanUseCashRegister();

    const amountSafe = normalizeAmount(amount);
    const conceptClean = String(concept || '').trim();

    if (!conceptClean) return fail('El concepto es obligatorio.', 'CONCEPT_REQUIRED');
    if (Money.init(amountSafe).lte(0)) return fail('El monto debe ser mayor a 0.', 'AMOUNT_INVALID');

    if (!mode.cloudEnabled) {
      return cashLocalRepository.registerMovement({ cashSessionId, type, amount: amountSafe, concept: conceptClean });
    }

    if (!mode.online) {
      showOfflineCashMessage();
      return fail(CASH_CLOUD_OFFLINE_MESSAGE, 'CLOUD_CASH_OFFLINE');
    }

    const idempotencyKey = generateIdempotencyKey({
      entityType: SYNC_ENTITY_TYPES.CASH_MOVEMENT,
      operation: SYNC_OPERATIONS.MOVEMENT,
      entityId: `${cashSessionId}:${type}:${Date.now()}`,
      prefix: 'cash_movement'
    });

    const response = await cashCloudRepository.registerCashMovement({
      licenseKey: mode.licenseKey,
      cashSessionId,
      type,
      amount: amountSafe,
      concept: conceptClean,
      idempotencyKey,
      metadata
    });

    if (response?.success === false) {
      return fail(response.message || 'No se pudo registrar el movimiento cloud.', response.code || 'CASH_MOVEMENT_FAILED', { response });
    }

    const applied = await applyCloudResponse(response);
    invalidateCloudCacheAfterCashMutation(mode.licenseKey);
    posSyncOrchestrator.pullIncremental('cash_movement').catch(() => {});

    return {
      success: true,
      cashSession: applied.cashSession,
      movement: applied.movement,
      response
    };
  },

  async adjustInitialFund({ cashSessionId, newAmount, reason, expectedVersion = null }) {
    const mode = getCashMode();
    assertCanUseCashRegister();

    if (!mode.cloudEnabled) {
      return cashLocalRepository.adjustInitialFund({ cashSessionId, newAmount, reason, expectedVersion });
    }

    if (!mode.online) {
      showOfflineCashMessage();
      return fail(CASH_CLOUD_OFFLINE_MESSAGE, 'CLOUD_CASH_OFFLINE');
    }

    const idempotencyKey = generateIdempotencyKey({
      entityType: SYNC_ENTITY_TYPES.CASH_SESSION,
      operation: SYNC_OPERATIONS.ADJUST,
      entityId: cashSessionId,
      prefix: 'cash_adjust'
    });

    const response = await cashCloudRepository.adjustInitialCashFund({
      licenseKey: mode.licenseKey,
      cashSessionId,
      newAmount: normalizeAmount(newAmount),
      reason,
      expectedVersion,
      idempotencyKey
    });

    if (response?.success === false) {
      return fail(response.message || 'No se pudo ajustar el fondo inicial.', response.code || 'CASH_ADJUST_FAILED', { response });
    }

    const applied = await applyCloudResponse(response);
    invalidateCloudCacheAfterCashMutation(mode.licenseKey);
    posSyncOrchestrator.pullIncremental('cash_adjust').catch(() => {});
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

    if (!mode.cloudEnabled) {
      return cashLocalRepository.closeCashSession({ cashSessionId, countedAmount, nextShiftFund, comments, expectedVersion });
    }

    if (!mode.online) {
      showOfflineCashMessage();
      return fail(CASH_CLOUD_OFFLINE_MESSAGE, 'CLOUD_CASH_OFFLINE');
    }

    const idempotencyKey = generateIdempotencyKey({
      entityType: SYNC_ENTITY_TYPES.CASH_SESSION,
      operation: SYNC_OPERATIONS.CLOSE,
      entityId: cashSessionId,
      prefix: 'cash_close'
    });

    const response = await cashCloudRepository.closeCashSession({
      licenseKey: mode.licenseKey,
      cashSessionId,
      closing: localClosingToCloudPayload({ countedAmount, nextShiftFund, comments }),
      expectedVersion,
      idempotencyKey
    });

    if (response?.success === false) {
      return fail(response.message || 'No se pudo cerrar caja cloud.', response.code || 'CASH_CLOSE_FAILED', { response });
    }

    const applied = await applyCloudResponse(response);
    invalidateCloudCacheAfterCashMutation(mode.licenseKey);
    posSyncOrchestrator.pullIncremental('cash_close').catch(() => {});
    return {
      success: true,
      cashSession: applied.cashSession,
      diferencia: applied.cashSession?.diferencia,
      response
    };
  },

  async pullCashSnapshot({ scope = 'mine', includeClosed = true, limit = 100, offset = 0 } = {}) {
    const mode = getCashMode();

    if (!mode.cloudEnabled || !mode.online) {
      const cashSessions = await cashLocalRepository.getHistory({
        actorKey: mode.actor.actorKey,
        staffUserId: mode.actor.staffUserId,
        isAdmin: !mode.actor.isStaff,
        limit
      });
      return { success: true, cashSessions, movements: [], readOnly: mode.readOnly };
    }

    const response = await cashCloudRepository.pullCashSnapshot({
      licenseKey: mode.licenseKey,
      scope,
      includeClosed,
      limit,
      offset
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
      const cashSessions = await cashLocalRepository.getHistory({ isAdmin: !mode.actor.isStaff, limit: filters.limit || 100 });
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
