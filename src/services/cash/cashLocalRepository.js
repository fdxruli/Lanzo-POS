import { db, STORES } from '../db/dexie';
import { generateID } from '../utils';
import { registrarMovimientoCaja } from '../cajaService';
import { loadCashSessionProjection, loadCashSessionTotals } from '../cajaProjection';
import { Money } from '../../utils/moneyMath';
import {
  cloudCashMovementToLocal,
  cloudCashSessionToLocal,
  CASH_SYNC_STATUS
} from './cashMapper';

const nowIso = () => new Date().toISOString();

const ensureOpen = async () => {
  if (!db.isOpen()) await db.open();
};

const sortByOpenedDesc = (items = []) => [...items].sort(
  (a, b) => Date.parse(b.fecha_apertura || b.updatedAt || 0) - Date.parse(a.fecha_apertura || a.updatedAt || 0)
);

const getAllCashSessions = async () => {
  await ensureOpen();
  return db.table(STORES.CAJAS).toArray();
};

const getAllCashMovements = async () => {
  await ensureOpen();
  return db.table(STORES.MOVIMIENTOS_CAJA).toArray();
};

const matchesActor = (record, { actorKey = null, staffUserId = null, isAdmin = false } = {}) => {
  if (isAdmin) return true;
  if (actorKey && record?.actorKey === actorKey) return true;
  if (staffUserId && record?.staffUserId === staffUserId) return true;
  return !actorKey && !staffUserId;
};

export const cashLocalRepository = {
  async getCurrentCashSession({ actorKey = null, staffUserId = null, isAdmin = false } = {}) {
    const sessions = await getAllCashSessions();
    const openSessions = sessions
      .filter((cashSession) => cashSession.estado === 'abierta')
      .filter((cashSession) => matchesActor(cashSession, { actorKey, staffUserId, isAdmin }));

    return sortByOpenedDesc(openSessions)[0] || null;
  },

  async getHistory({ actorKey = null, staffUserId = null, isAdmin = true, limit = 50 } = {}) {
    const sessions = await getAllCashSessions();
    return sortByOpenedDesc(
      sessions.filter((cashSession) => matchesActor(cashSession, { actorKey, staffUserId, isAdmin }))
    ).slice(0, limit);
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

  async openCashSession(openingData) {
    await ensureOpen();
    return db.transaction('rw', db.table(STORES.CAJAS), async () => {
      const openSessions = await db.table(STORES.CAJAS).where('estado').equals('abierta').toArray();
      if (openSessions.length > 0) {
        return sortByOpenedDesc(openSessions)[0];
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
        syncStatus: CASH_SYNC_STATUS.LOCAL,
        updatedAt: now
      };

      await db.table(STORES.CAJAS).put(cashSession);
      return cashSession;
    });
  },

  async registerMovement({ cashSessionId, type, amount, concept, idempotencyKey = null, referenceId = null, metadata = {} }) {
    const { cajaActualizada, movimiento, alreadyRegistered = false } = await registrarMovimientoCaja(
      cashSessionId,
      type,
      amount,
      concept,
      {
        idempotencyKey,
        metadata: {
          ...metadata,
          ...(referenceId ? { referenceId } : {})
        }
      }
    );
    return {
      success: true,
      cashSession: cajaActualizada,
      movement: movimiento,
      alreadyRegistered
    };
  },

  async adjustInitialFund({ cashSessionId, newAmount, reason, expectedVersion = null }) {
    await ensureOpen();
    const amountSafe = Money.init(newAmount);
    if (amountSafe.lt(0)) throw new Error('El fondo no puede ser negativo.');

    return db.transaction('rw', [db.table(STORES.CAJAS), db.table(STORES.MOVIMIENTOS_CAJA)], async () => {
      const cashSession = await db.table(STORES.CAJAS).get(cashSessionId);
      if (!cashSession) throw new Error('CRITICAL: La caja no existe.');
      if (cashSession.estado !== 'abierta') throw new Error('Solo se puede ajustar una caja abierta.');

      const currentVersion = cashSession.updatedAt || cashSession.fecha_apertura;
      if (expectedVersion && currentVersion !== expectedVersion) {
        throw new Error('CONCURRENCY_ERROR: Modificación concurrente detectada.');
      }

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

  async closeCashSession({ cashSessionId, countedAmount, nextShiftFund, comments = '', expectedVersion = null }) {
    await ensureOpen();
    const countedSafe = Money.init(countedAmount);
    const nextFundSafe = Money.init(nextShiftFund);
    if (countedSafe.lt(0) || nextFundSafe.lt(0)) throw new Error('Los montos de auditoria no pueden ser negativos.');
    if (nextFundSafe.gt(countedSafe)) throw new Error('El fondo del siguiente turno no puede ser mayor al dinero fisico contado.');

    return db.transaction('rw', [db.table(STORES.CAJAS), db.table(STORES.SALES)], async () => {
      const cashSession = await db.table(STORES.CAJAS).get(cashSessionId);
      if (!cashSession) throw new Error('CRITICAL: La caja no existe.');
      if (cashSession.estado !== 'abierta') throw new Error('La caja ya no está abierta.');

      const currentVersion = cashSession.updatedAt || cashSession.fecha_apertura;
      if (expectedVersion && currentVersion !== expectedVersion) {
        throw new Error('CONCURRENCY_ERROR: Operación de cierre abortada. La caja fue modificada externamente.');
      }

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
    if (!cloudSession?.id) return null;
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
    if (!cloudMovement?.id) return null;
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
      .filter((movement) => movement.cash_session_id === cashSessionId || movement.caja_id === cashSessionId)
      .sort((a, b) => Date.parse(b.fecha || 0) - Date.parse(a.fecha || 0));
  }
};

export default cashLocalRepository;
