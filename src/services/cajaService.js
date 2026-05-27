// src/services/cajaService.js
// ============================================================================
// Single Source of Truth para operaciones de escritura en Caja Registradora.
// Toda escritura a STORES.CAJAS y STORES.MOVIMIENTOS_CAJA DEBE pasar por
// este servicio para garantizar consistencia de nomenclatura y atomicidad.
// ============================================================================

import { db, STORES } from './db/dexie';
import { generateID } from './utils';
import { Money } from '../utils/moneyMath';
import Logger from './Logger';

// ============================================================================
// CONSTANTES CANÓNICAS
// ============================================================================

/**
 * Enum de tipos de movimiento de caja.
 * Cualquier escritura que use un tipo fuera de este diccionario es un BUG.
 */
export const MOVIMIENTO_TIPOS = {
  ENTRADA: 'entrada',
  SALIDA: 'salida',
  AJUSTE_ENTRADA: 'ajuste_entrada',
  AJUSTE_SALIDA: 'ajuste_salida'
};

/** Array plano de valores permitidos (para validación rápida con .includes()) */
export const MOVIMIENTO_TIPOS_VALIDOS = Object.values(MOVIMIENTO_TIPOS);

/**
 * Configuración operativa de la caja.
 * Centralizada aquí para que todos los consumidores compartan los mismos umbrales.
 */
export const CAJA_CONFIG = {
  MAX_CASH_THRESHOLD: 50000, // Límite máximo sugerido en caja (configurable)
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY_MS: 300,
  CONCURRENCY_ERROR_MESSAGE: 'La caja fue modificada por otra transacción. Recarga e intenta de nuevo.'
};

// ============================================================================
// HELPERS INTERNOS (no exportados)
// ============================================================================

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Ejecuta una operación con reintentos y backoff exponencial.
 * Los errores de concurrencia (CONCURRENCY_ERROR) NO se reintentan.
 */
const retryWithBackoff = async (operation, maxAttempts = CAJA_CONFIG.RETRY_ATTEMPTS, context = '') => {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const isConcurrencyError = error.message?.includes('CONCURRENCY_ERROR');

      // No retries en errores de concurrencia - requieren acción del usuario
      if (isConcurrencyError) {
        Logger.warn(`[CajaService] ${context}: Error de concurrencia no reintentable`);
        throw error;
      }

      if (attempt < maxAttempts) {
        const delayMs = CAJA_CONFIG.RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        Logger.warn(`[CajaService] ${context}: Reintento ${attempt + 1}/${maxAttempts} en ${delayMs}ms`);
        await delay(delayMs);
      }
    }
  }

  throw lastError;
};

// ============================================================================
// FUNCIONES PÚBLICAS
// ============================================================================

/**
 * Lógica pura de escritura de movimiento de caja.
 * NO crea su propia transacción Dexie ni aplica reintentos.
 *
 * PRECONDICIÓN: El llamador DEBE ejecutar esto dentro de una transacción Dexie
 * que incluya db.table(STORES.CAJAS) y db.table(STORES.MOVIMIENTOS_CAJA).
 *
 * Uso típico: Desde dentro de otra transacción atómica que involucra más tablas
 * (ej: customerCreditRepository.processPayment).
 *
 * @param {string} cajaId - ID de la caja abierta
 * @param {string} tipo - Tipo de movimiento (entrada|salida|ajuste_entrada|ajuste_salida)
 * @param {string|number} monto - Monto del movimiento (> 0)
 * @param {string} concepto - Concepto descriptivo (obligatorio)
 * @returns {Promise<{cajaActualizada: Object, movimiento: Object}>}
 */
export async function registrarMovimientoCajaEnTransaccion(cajaId, tipo, monto, concepto) {
  // --- Validación de invariantes de datos ---
  if (!MOVIMIENTO_TIPOS_VALIDOS.includes(tipo)) {
    throw new Error(
      `Tipo de movimiento '${tipo}' no permitido. Valores válidos: ${MOVIMIENTO_TIPOS_VALIDOS.join(', ')}`
    );
  }

  const montoSafe = Money.init(monto);
  if (montoSafe.lte(0)) {
    throw new Error('El monto del movimiento debe ser mayor a 0.');
  }

  const conceptoLimpio = String(concepto || '').trim();
  if (!conceptoLimpio) {
    throw new Error('El concepto del movimiento es obligatorio.');
  }

  // --- Lectura y validación de estado ---
  const cajaDb = await db.table(STORES.CAJAS).get(cajaId);
  if (!cajaDb) {
    throw new Error(`CRITICAL: La caja ${cajaId} no existe en la base de datos.`);
  }
  if (cajaDb.estado !== 'abierta') {
    throw new Error('Transacción abortada: La caja no está abierta.');
  }

  // --- Mutación atómica ---
  const esEntrada = tipo === MOVIMIENTO_TIPOS.ENTRADA || tipo === MOVIMIENTO_TIPOS.AJUSTE_ENTRADA;

  if (esEntrada) {
    const currentEntradas = Money.init(cajaDb.entradas_efectivo || 0);
    cajaDb.entradas_efectivo = Money.toExactString(Money.add(currentEntradas, montoSafe));
  } else {
    const currentSalidas = Money.init(cajaDb.salidas_efectivo || 0);
    cajaDb.salidas_efectivo = Money.toExactString(Money.add(currentSalidas, montoSafe));
  }

  cajaDb.updatedAt = new Date().toISOString();
  await db.table(STORES.CAJAS).put(cajaDb);

  const movimiento = {
    id: generateID('mov'),
    caja_id: cajaId,
    tipo,
    monto: Money.toExactString(montoSafe),
    concepto: conceptoLimpio,
    fecha: new Date().toISOString()
  };
  await db.table(STORES.MOVIMIENTOS_CAJA).put(movimiento);

  return { cajaActualizada: cajaDb, movimiento };
}

/**
 * Registra un movimiento de caja de forma atómica y con reintentos.
 * Crea su propia transacción Dexie. NO llamar desde dentro de otra transacción.
 *
 * Uso típico: Desde hooks de React (useCaja) o cualquier punto que no esté
 * ya dentro de una transacción Dexie.
 *
 * @param {string} cajaId - ID de la caja abierta
 * @param {string} tipo - Tipo de movimiento (entrada|salida|ajuste_entrada|ajuste_salida)
 * @param {string|number} monto - Monto del movimiento (> 0)
 * @param {string} concepto - Concepto descriptivo (obligatorio)
 * @returns {Promise<{cajaActualizada: Object, movimiento: Object}>}
 */
export async function registrarMovimientoCaja(cajaId, tipo, monto, concepto) {
  return await retryWithBackoff(async () => {
    return await db.transaction(
      'rw',
      [db.table(STORES.CAJAS), db.table(STORES.MOVIMIENTOS_CAJA)],
      async () => {
        return await registrarMovimientoCajaEnTransaccion(cajaId, tipo, monto, concepto);
      }
    );
  }, CAJA_CONFIG.RETRY_ATTEMPTS, `registrarMovimiento ${tipo} $${Money.toNumber(Money.init(monto)).toFixed(2)}`);
}
