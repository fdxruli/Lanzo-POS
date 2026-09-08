import { db, STORES } from '../db/dexie';
import { generateID } from '../utils';
import { registrarMovimientoCaja } from '../cajaService';
import { loadCashSessionProjection, loadCashSessionTotals } from '../cajaProjection';
import { Money } from '../../utils/moneyMath';
import {
  areCashStationsEquivalent,
  getCashStationIdentity,
  isCanonicalCashStation,
  isLocalStationKey
} from './cashStation';
import {
  CASH_FINANCIAL_CODES,
  CASH_FINANCIAL_STATUS,
  CashFinancialError,
  assertCashActorContextCurrent
} from './cashFinancialGate';
import {
  cloudCashMovementToLocal,
  cloudCashSessionToLocal,
  CASH_SYNC_STATUS
} from './cashMapper';

const nowIso = () => new Date().toISOString();

const localCashProjectionDiagnostics = {
  invalidCashSessionRecords: 0,
  invalidCashMovementRecords: 0
};

const isRecord = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));

const hasCloudValue = (value) => (
  value !== null
  && value !== undefined
  && String(value).trim() !== ''
);

const getCloudRecordActorKey = (value) => (
  value?.actor_key
  || value?.actorKey
  || value?.staff_user_id
  || value?.staffUserId
  || null
);

const getCloudRecordStationId = (value) => [
  value?.cash_station_id,
  value?.cashStationId,
  value?.metadata?.cash_station_id,
  value?.metadata?.cashStationId,
  value?.cash_station?.id,
  value?.cashStation?.id
].find((candidate) => isCanonicalCashStation(candidate)) || null;

const isCompleteCloudCashSession = (value) => Boolean(
  isRecord(value)
  && hasCloudValue(value.id)
  && hasCloudValue(value.status || value.estado)
  && hasCloudValue(getCloudRecordActorKey(value))
  && Boolean(getCloudRecordStationId(value))
);

const isCompleteCloudCashMovement = (value) => Boolean(
  isRecord(value)
  && hasCloudValue(value.id)
  && hasCloudValue(value.cash_session_id || value.cashSessionId)
  && hasCloudValue(value.type || value.tipo)
  && (value.amount !== undefined && value.amount !== null
    || value.monto !== undefined && value.monto !== null)
  && hasCloudValue(getCloudRecordActorKey(value))
  && Boolean(getCloudRecordStationId(value))
);
const recordLocalRows = (rows, kind) => {
  for (const row of rows || []) {
    if (!isRecord(row)) {
      if (kind === 'session') localCashProjectionDiagnostics.invalidCashSessionRecords += 1;
      if (kind === 'movement') localCashProjectionDiagnostics.invalidCashMovementRecords += 1;
    }
  }
  return rows || [];
};

export const getCashLocalProjectionDiagnostics = () => ({ ...localCashProjectionDiagnostics });

const ensureOpen = async () => {
  if (!db.isOpen()) await db.open();
};

const sortByOpenedDesc = (items = []) => items.filter(Boolean).sort(
  (a, b) => Date.parse(b.fecha_apertura || b.updatedAt || 0) - Date.parse(a.fecha_apertura || a.updatedAt || 0)
);

const getAllCashSessions = async () => {
  await ensureOpen();
  return recordLocalRows(await db.table(STORES.CAJAS).toArray(), 'session');
};

const getAllCashMovements = async () => {
  await ensureOpen();
  return recordLocalRows(await db.table(STORES.MOVIMIENTOS_CAJA).toArray(), 'movement');
};

const matchesActor = (record, { actorKey = null, staffUserId = null } = {}) => {
  if (actorKey && record?.actorKey === actorKey) return true;
  if (staffUserId && record?.staffUserId === staffUserId) return true;
  // `isAdmin` is an audit scope hint, never an ownership grant.  A normal
  // current-session read with no actor can only return legacy records.
  return !actorKey && !staffUserId && !record?.actorKey && !hasSessionStationIdentity(record);
};

const createCashError = (code, message = code, details = {}) => (
  new CashFinancialError(code, message, details)
);

const getSessionActorKey = (session) => session?.actorKey || session?.actor_key || null;
const getSessionStationId = (session) => [
  session?.cashStationId,
  session?.cash_station_id,
  session?.metadata?.cashStationId,
  session?.metadata?.cash_station_id
].find((value) => isCanonicalCashStation(value)) || null;
const getSessionLocalStationKey = (session) => [
  session?.localStationKey,
  session?.local_station_key,
  session?.metadata?.localStationKey,
  session?.metadata?.local_station_key,
  session?.cashStationId,
  session?.cash_station_id,
  session?.metadata?.cashStationId,
  session?.metadata?.cash_station_id
].find((value) => isLocalStationKey(value)) || null;
const hasSessionStationIdentity = (session) => Boolean(
  getSessionStationId(session) || getSessionLocalStationKey(session)
);

const resolveStationScope = ({ cashStationId = null, localStationKey = null } = {}) => ({
  cashStationId: isCanonicalCashStation(cashStationId) ? cashStationId : null,
  localStationKey: localStationKey
    || (isLocalStationKey(cashStationId) ? cashStationId : null)
});

const matchesStation = (session, scope = {}) => {
  const { cashStationId, localStationKey } = resolveStationScope(scope);
  if (cashStationId) return Boolean(
    getSessionStationId(session)
    && areCashStationsEquivalent(getSessionStationId(session), cashStationId)
  );
  if (localStationKey) return Boolean(
    getSessionLocalStationKey(session)
    && areCashStationsEquivalent(getSessionLocalStationKey(session), localStationKey)
  );
  return false;
};
const isOpenSession = (session) => session?.estado === 'abierta' || session?.status === 'open';

const assertLocalSessionOwnership = async ({
  cashSessionId,
  actorKey,
  cashStationId,
  localStationKey = null,
  actorContext = null,
  operation = 'cash mutation'
} = {}) => {
  if (actorContext) assertCashActorContextCurrent(actorContext);
  const session = await db.table(STORES.CAJAS).get(cashSessionId);
  if (!session) throw createCashError('CASH_SESSION_NOT_FOUND', 'La sesión de caja no existe.');
  if (!isOpenSession(session)) throw createCashError(CASH_FINANCIAL_CODES.SESSION_NOT_OPEN, 'La sesión de caja ya no está abierta.');

  const owner = getSessionActorKey(session);
  const station = getSessionStationId(session);
  const sessionLocalStationKey = getSessionLocalStationKey(session);
  if (!owner || !hasSessionStationIdentity(session)) {
    throw createCashError(CASH_FINANCIAL_CODES.STATION_UNRESOLVED, 'La sesión local no tiene identidad financiera determinista.', {
      operation,
      cashSessionId,
      cashIdentityState: session.cashIdentityState || 'legacy_unresolved'
    });
  }
  if (!actorKey || owner !== actorKey) {
    throw createCashError(CASH_FINANCIAL_CODES.HANDOFF_REQUIRED, 'La sesión de caja pertenece a otro actor.', {
      operation,
      ownerActorKey: owner,
      actorKey
    });
  }
  const scope = resolveStationScope({ cashStationId, localStationKey });
  if (!matchesStation(session, scope)) {
    throw createCashError(CASH_FINANCIAL_CODES.STATION_MISMATCH, 'La sesión no pertenece a la estación financiera actual.', {
      operation,
      sessionStationId: station,
      sessionLocalStationKey,
      cashStationId: scope.cashStationId,
      localStationKey: scope.localStationKey
    });
  }
  return session;
};

export const cashLocalRepository = {
  async getCurrentCashSession({ actorKey = null, staffUserId = null, isAdmin = false, includeAll = false, cashStationId = null, localStationKey = null } = {}) {
    const stationScope = resolveStationScope({ cashStationId, localStationKey });
    const sessions = await getAllCashSessions();
    const openSessions = sessions
      .filter(Boolean)
      .filter((cashSession) => isOpenSession(cashSession))
      .filter((cashSession) => (
        includeAll
          ? true
          : matchesActor(cashSession, { actorKey, staffUserId, isAdmin })
      ))
      .filter((cashSession) => (
        (!stationScope.cashStationId && !stationScope.localStationKey)
          || matchesStation(cashSession, stationScope)
      ));

    return sortByOpenedDesc(openSessions)[0] || null;
  },

  async getHistory({
    actorKey = null,
    staffUserId = null,
    isAdmin = false,
    includeAll = false,
    cashStationId = null,
    localStationKey = null,
    limit = 50
  } = {}) {
    const stationScope = resolveStationScope({ cashStationId, localStationKey });
    const sessions = await getAllCashSessions();
    return sortByOpenedDesc(
      sessions.filter(Boolean).filter((cashSession) => (
        includeAll
          ? true
          : matchesActor(cashSession, { actorKey, staffUserId, isAdmin })
      )).filter((cashSession) => (
        (!stationScope.cashStationId && !stationScope.localStationKey)
          || matchesStation(cashSession, stationScope)
      ))
    ).slice(0, limit);
  },

  async getFinancialState({
    actorKey = null,
    cashStationId = null,
    localStationKey = null,
    online = true,
    cloudEnabled = false,
    stateKnown = true
  } = {}) {
    const stationScope = resolveStationScope({ cashStationId, localStationKey });
    const requestedStation = cloudEnabled
      ? stationScope.cashStationId
      : stationScope.localStationKey;
    const sessions = await getAllCashSessions();
    const openSessions = sessions.filter(Boolean).filter(isOpenSession);
    const ownSession = openSessions.find((session) => (
      getSessionActorKey(session) === actorKey
      && (!requestedStation || matchesStation(session, stationScope))
    )) || null;
    const stationOpenCashSession = requestedStation
      ? openSessions.find((session) => matchesStation(session, stationScope)) || null
      : null;
    const unresolvedOpen = openSessions.find((session) => !hasSessionStationIdentity(session)) || null;

    if (!requestedStation) {
      return {
        status: CASH_FINANCIAL_STATUS.BLOCKED,
        code: CASH_FINANCIAL_CODES.STATION_UNRESOLVED,
        cashSession: null,
        stationOpenCashSession: unresolvedOpen,
        cashStationId: stationScope.cashStationId,
        localStationKey: stationScope.localStationKey,
        actorKey,
        stateKnown
      };
    }

    if (unresolvedOpen && !stationOpenCashSession && !ownSession) {
      return {
        status: CASH_FINANCIAL_STATUS.BLOCKED,
        code: CASH_FINANCIAL_CODES.STATION_UNRESOLVED,
        cashSession: null,
        stationOpenCashSession: unresolvedOpen,
        cashStationId: stationScope.cashStationId,
        localStationKey: stationScope.localStationKey,
        actorKey,
        stateKnown
      };
    }

    if (cloudEnabled && !online && !stateKnown && !stationOpenCashSession && !ownSession) {
      return {
        status: CASH_FINANCIAL_STATUS.BLOCKED,
        code: CASH_FINANCIAL_CODES.HANDOFF_REQUIRES_ONLINE,
        cashSession: null,
        stationOpenCashSession: null,
        cashStationId: stationScope.cashStationId,
        localStationKey: stationScope.localStationKey,
        actorKey,
        stateKnown: false,
        online,
        cloudEnabled
      };
    }

    const stationOwner = getSessionActorKey(stationOpenCashSession);
    if (stationOpenCashSession && stationOwner !== actorKey) {
      return {
        status: CASH_FINANCIAL_STATUS.HANDOFF_REQUIRED,
        code: CASH_FINANCIAL_CODES.HANDOFF_REQUIRED,
        cashSession: null,
        stationOpenCashSession,
        cashStationId: stationScope.cashStationId,
        localStationKey: stationScope.localStationKey,
        actorKey,
        stateKnown,
        online,
        cloudEnabled
      };
    }

    return {
      status: ownSession ? CASH_FINANCIAL_STATUS.OWN_SESSION_OPEN : CASH_FINANCIAL_STATUS.NO_SESSION,
      code: null,
      cashSession: ownSession,
      stationOpenCashSession: stationOpenCashSession || ownSession,
      cashStationId: stationScope.cashStationId,
      localStationKey: stationScope.localStationKey,
      actorKey,
      stateKnown,
      online,
      cloudEnabled
    };
  },

  async loadProjection(cashSession) {
    if (!cashSession) {
      return {
        movements: [],
        totals: { ventasContado: '0', abonosFiado: '0' }
      };
    }
    return loadCashSessionProjection(db, cashSession);
  },

  async openCashSession(openingData = {}) {
    await ensureOpen();
    const actorKey = openingData.actorKey || openingData.originActorKey || null;
    if (!actorKey) throw createCashError('CASH_ACTOR_CONTEXT_REQUIRED', 'Se requiere el actor autenticado para abrir caja.');
    const explicitLocalStationKey = openingData.localStationKey
      || (isLocalStationKey(openingData.cashStationId) ? openingData.cashStationId : null);
    const identity = explicitLocalStationKey
      ? {
        deviceFingerprint: openingData.deviceFingerprint
          || explicitLocalStationKey.slice('local:device:'.length),
        localStationKey: explicitLocalStationKey,
        cashStationId: null,
        deviceId: null,
        identityState: 'local'
      }
      : await getCashStationIdentity({
        licenseKey: openingData.licenseKey || null,
        deviceFingerprint: openingData.deviceFingerprint || null,
        deviceId: openingData.deviceId || null
      });
    const station = {
      deviceFingerprint: openingData.deviceFingerprint || identity.deviceFingerprint,
      localStationKey: explicitLocalStationKey || identity.localStationKey,
      // Local-created rows do not promote a browser key into a cloud station.
      cashStationId: isCanonicalCashStation(openingData.cashStationId)
        ? openingData.cashStationId
        : null,
      deviceId: openingData.canonicalDeviceId || null,
      identityState: isCanonicalCashStation(openingData.cashStationId)
        ? (openingData.cashIdentityState || 'canonical')
        : 'local'
    };

    return db.transaction('rw', db.table(STORES.CAJAS), async () => {
      const openSessions = (await db.table(STORES.CAJAS).where('estado').equals('abierta').toArray()).filter(Boolean);
      const stationOpen = openSessions.find((session) => matchesStation(session, {
        localStationKey: station.localStationKey
      })) || null;
      if (stationOpen) {
        if (getSessionActorKey(stationOpen) === actorKey) return stationOpen;
        throw createCashError(CASH_FINANCIAL_CODES.HANDOFF_REQUIRED, 'La estación financiera requiere cierre y reconciliación antes de cambiar de actor.', {
          localStationKey: station.localStationKey,
          cashSession: stationOpen
        });
      }

      const isStaffActor = openingData.deviceRole === 'staff' || String(actorKey).startsWith('staff:');
      if (isStaffActor) {
        const actorOpen = openSessions.find((session) => getSessionActorKey(session) === actorKey) || null;
        if (actorOpen) {
          throw createCashError('CASH_SESSION_ALREADY_OPEN', 'El actor ya tiene una sesión de caja abierta en otra estación.', {
            cashSession: actorOpen,
            cashStationId: actorOpen.cashStationId || null
          });
        }
      }

      const unresolvedOpen = openSessions.find((session) => !hasSessionStationIdentity(session));
      if (unresolvedOpen) {
        throw createCashError(CASH_FINANCIAL_CODES.STATION_UNRESOLVED, 'Existe una caja abierta legacy cuya estación no puede determinarse de forma segura.', {
          cashSession: unresolvedOpen
        });
      }

      const now = nowIso();
      const cashSession = {
        id: generateID('caja'),
        fecha_apertura: now,
        monto_inicial: openingData.montoInicial,
        monto_conteo_inicial: openingData.montoContado,
        monto_fondo_sugerido: openingData.montoSugerido,
        diferencia_apertura: openingData.diferenciaApertura,
        responsable_apertura: openingData.responsable,
        politica_apertura: openingData.politicaApertura,
        apertura_origen: openingData.origen,
        estado: 'abierta',
        fecha_cierre: null,
        monto_cierre: null,
        ventas_efectivo: '0',
        entradas_efectivo: '0',
        salidas_efectivo: '0',
        diferencia: null,
        es_auto_apertura: openingData.esAutoApertura,
        actorKey,
        originActorKey: actorKey,
        openedByActorKey: actorKey,
        originActorGeneration: openingData.actorGeneration ?? null,
        deviceId: station.deviceId || null,
        deviceFingerprint: station.deviceFingerprint || null,
        deviceRole: openingData.deviceRole || null,
        cashStationId: station.cashStationId,
        localStationKey: station.localStationKey,
        cashIdentityState: station.identityState || 'canonical',
        lastIdempotencyKey: openingData.idempotencyKey || null,
        syncStatus: CASH_SYNC_STATUS.LOCAL,
        updatedAt: now
      };

      await db.table(STORES.CAJAS).put(cashSession);
      return cashSession;
    });
  },

  async registerMovement({ cashSessionId, type, amount, concept, idempotencyKey = null, referenceId = null, metadata = {}, actorKey = null, cashStationId = null, localStationKey = null, actorContext = null }) {
    const session = await assertLocalSessionOwnership({
      cashSessionId,
      actorKey,
      cashStationId,
      localStationKey,
      actorContext,
      operation: 'cash movement'
    });
    const { cajaActualizada, movimiento, alreadyRegistered = false } = await registrarMovimientoCaja(
      cashSessionId,
      type,
      amount,
      concept,
      {
        idempotencyKey,
      metadata: {
          ...metadata,
          ...(referenceId ? { referenceId } : {}),
          actorKey,
          originActorKey: actorKey,
          cashStationId,
          localStationKey,
          originActorGeneration: actorContext?.generation ?? null,
          cashSessionId: session.id
        },
        actorKey,
        cashStationId,
        localStationKey,
        actorContext
      }
    );
    return {
      success: true,
      cashSession: cajaActualizada,
      movement: movimiento,
      alreadyRegistered
    };
  },

  async adjustInitialFund({ cashSessionId, newAmount, reason, expectedVersion = null, idempotencyKey = null, actorKey = null, cashStationId = null, localStationKey = null, actorContext = null }) {
    await ensureOpen();
    await assertLocalSessionOwnership({ cashSessionId, actorKey, cashStationId, localStationKey, actorContext, operation: 'cash initial fund adjustment' });
    const amountSafe = Money.init(newAmount);
    if (amountSafe.lt(0)) throw new Error('El fondo no puede ser negativo.');

    return db.transaction('rw', [db.table(STORES.CAJAS), db.table(STORES.MOVIMIENTOS_CAJA)], async () => {
      const cashSession = await db.table(STORES.CAJAS).get(cashSessionId);
      if (!cashSession) throw new Error('CRITICAL: La caja no existe.');
      if (cashSession.estado !== 'abierta') throw new Error('Solo se puede ajustar una caja abierta.');

      const existingMovement = idempotencyKey
        ? await db.table(STORES.MOVIMIENTOS_CAJA).where('idempotencyKey').equals(idempotencyKey).first()
        : null;
      if (existingMovement) return { success: true, noChange: true, alreadyRegistered: true, cashSession, movement: existingMovement };

      const currentVersion = cashSession.updatedAt || cashSession.fecha_apertura;
      if (expectedVersion && currentVersion !== expectedVersion) {
        throw new Error('CONCURRENCY_ERROR: Modificación concurrente detectada.');
      }
      if (actorContext) assertCashActorContextCurrent(actorContext);

      const previousSafe = Money.init(cashSession.monto_inicial || 0);
      const deltaSafe = Money.subtract(amountSafe, previousSafe);
      if (deltaSafe.eq(0)) {
        return { success: true, noChange: true, cashSession };
      }

      const now = nowIso();
      cashSession.monto_inicial = Money.toExactString(amountSafe);
      cashSession.updatedAt = now;
      await db.table(STORES.CAJAS).put(cashSession);

      const movement = {
        id: generateID('mov'),
        caja_id: cashSession.id,
        cash_session_id: cashSession.id,
        tipo: 'fondo_inicial_ajuste',
        monto: Money.toExactString(deltaSafe.abs()),
        concepto: `Ajuste fondo inicial: $${Money.toNumber(previousSafe).toFixed(2)} -> $${Money.toNumber(amountSafe).toFixed(2)}. Motivo: ${reason}`,
        fecha: now,
        actor: cashSession.responsable_apertura || 'Administrador local',
        actorKey,
        originActorKey: actorKey,
        performedByActorKey: actorKey,
        cashStationId: isCanonicalCashStation(cashStationId) ? cashStationId : null,
        localStationKey: localStationKey || (isLocalStationKey(cashStationId) ? cashStationId : null),
        idempotencyKey,
        originActorGeneration: actorContext?.generation ?? null,
        audit: {
          eventType: 'INITIAL_FUND_ADJUSTMENT',
          previousAmount: Money.toExactString(previousSafe),
          newAmount: Money.toExactString(amountSafe),
          delta: Money.toExactString(deltaSafe),
          reason,
          changedAt: now
        }
      };

      await db.table(STORES.MOVIMIENTOS_CAJA).put(movement);
      return { success: true, cashSession, movement };
    });
  },

  async closeCashSession({ cashSessionId, countedAmount, nextShiftFund, comments = '', expectedVersion = null, idempotencyKey = null, actorKey = null, cashStationId = null, localStationKey = null, actorContext = null }) {
    await ensureOpen();
    const initialSession = await db.table(STORES.CAJAS).get(cashSessionId);
    if (initialSession && !isOpenSession(initialSession)) {
      if (initialSession.estado === 'cerrada'
        && initialSession.closedByActorKey === actorKey
        && matchesStation(initialSession, { cashStationId, localStationKey })) {
        if (actorContext) assertCashActorContextCurrent(actorContext);
        return {
          success: true,
          alreadyClosed: true,
          cashSession: initialSession,
          diferencia: initialSession.diferencia
        };
      }
    }
    await assertLocalSessionOwnership({ cashSessionId, actorKey, cashStationId, localStationKey, actorContext, operation: 'cash session close' });
    const countedSafe = Money.init(countedAmount);
    const nextFundSafe = Money.init(nextShiftFund);
    if (countedSafe.lt(0) || nextFundSafe.lt(0)) throw new Error('Los montos de auditoria no pueden ser negativos.');
    if (nextFundSafe.gt(countedSafe)) throw new Error('El fondo del siguiente turno no puede ser mayor al dinero fisico contado.');

    return db.transaction('rw', [db.table(STORES.CAJAS), db.table(STORES.SALES)], async () => {
      const cashSession = await db.table(STORES.CAJAS).get(cashSessionId);
      if (!cashSession) throw new Error('CRITICAL: La caja no existe.');
      if (cashSession.estado !== 'abierta') {
        if (cashSession.estado === 'cerrada'
          && cashSession.closedByActorKey === actorKey
          && matchesStation(cashSession, { cashStationId, localStationKey })) {
          return {
            success: true,
            alreadyClosed: true,
            cashSession,
            diferencia: cashSession.diferencia
          };
        }
        throw new Error('La caja ya no está abierta.');
      }

      const currentVersion = cashSession.updatedAt || cashSession.fecha_apertura;
      if (expectedVersion && currentVersion !== expectedVersion) {
        throw new Error('CONCURRENCY_ERROR: Operación de cierre abortada. La caja fue modificada externamente.');
      }
      if (actorContext) assertCashActorContextCurrent(actorContext);

      const closedAt = nowIso();
      const { ventasContado, abonosFiado } = await loadCashSessionTotals(db, cashSession, closedAt);
      const totalSalesCashSafe = Money.add(ventasContado, abonosFiado);
      const expectedSafe = Money.subtract(
        Money.add(
          Money.add(cashSession.monto_inicial || 0, totalSalesCashSafe),
          cashSession.entradas_efectivo || 0
        ),
        cashSession.salidas_efectivo || 0
      );
      const differenceSafe = Money.subtract(countedSafe, expectedSafe);

      const closed = {
        ...cashSession,
        fecha_cierre: closedAt,
        monto_cierre: Money.toExactString(countedSafe),
        monto_fondo_siguiente_turno: Money.toExactString(nextFundSafe),
        ventas_efectivo: Money.toExactString(totalSalesCashSafe),
        diferencia: Money.toExactString(differenceSafe),
        comentarios_auditoria: comments,
        estado: 'cerrada',
        closedByActorKey: actorKey,
        closedByDeviceId: cashSession.deviceId || null,
        lastCloseIdempotencyKey: idempotencyKey || null,
        updatedAt: nowIso(),
        detalle_cierre: {
          ventas_contado: Money.toExactString(ventasContado),
          abonos_fiado: Money.toExactString(abonosFiado),
          total_teorico: Money.toExactString(expectedSafe)
        }
      };

      await db.table(STORES.CAJAS).put(closed);
      return {
        success: true,
        cashSession: closed,
        diferencia: Money.toExactString(differenceSafe)
      };
    });
  },

  async applyCloudCashSession(cloudSession) {
    if (!isCompleteCloudCashSession(cloudSession)) {
      localCashProjectionDiagnostics.invalidCashSessionRecords += 1;
      return null;
    }
    await ensureOpen();
    const existing = await db.table(STORES.CAJAS).get(cloudSession.id);
    const local = cloudCashSessionToLocal(cloudSession, existing);
    if (!local) return null;
    await db.table(STORES.CAJAS).put(local);
    return local;
  },

  async applyCloudCashSessions(cloudSessions = []) {
    const applied = [];
    for (const cloudSession of cloudSessions || []) {
      const local = await this.applyCloudCashSession(cloudSession);
      if (local) applied.push(local);
    }
    return applied;
  },

  async applyCloudCashMovement(cloudMovement) {
    if (!isCompleteCloudCashMovement(cloudMovement)) {
      localCashProjectionDiagnostics.invalidCashMovementRecords += 1;
      return null;
    }
    await ensureOpen();
    const existing = await db.table(STORES.MOVIMIENTOS_CAJA).get(cloudMovement.id);
    const local = cloudCashMovementToLocal(cloudMovement, existing);
    if (!local) return null;
    await db.table(STORES.MOVIMIENTOS_CAJA).put(local);
    return local;
  },

  async applyCloudCashMovements(cloudMovements = []) {
    const applied = [];
    for (const cloudMovement of cloudMovements || []) {
      const local = await this.applyCloudCashMovement(cloudMovement);
      if (local) applied.push(local);
    }
    return applied;
  },

  async getMovementsForSession(cashSessionId) {
    const movements = await getAllCashMovements();
    return movements
      .filter(Boolean)
      .filter(isRecord)
      .filter((movement) => (
        movement.cash_session_id === cashSessionId
        || movement.caja_id === cashSessionId
        || movement.cashSessionId === cashSessionId
      ))
      .sort((a, b) => Date.parse(b.fecha || 0) - Date.parse(a.fecha || 0));
  }
};

export default cashLocalRepository;
