// src/hooks/useCaja.js
import { useState, useEffect, useCallback, useRef } from 'react';
import { liveQuery } from 'dexie';
import { showMessageModal, generateID } from '../services/utils';
import { loadDataPaginated, STORES, initDB, db } from '../services/db/index';
import Logger from '../services/Logger';
import { Money } from '../utils/moneyMath';
import { registrarMovimientoCaja, MOVIMIENTO_TIPOS, CAJA_CONFIG } from '../services/cajaService';
import {
  CASH_OPENING_POLICY_EVENT,
  CASH_OPENING_POLICY,
  buildAutomaticOpeningData,
  buildManualOpeningData,
  getCashOpeningPolicy
} from '../services/cashOpeningPolicy';
import {
  loadCashSessionProjection,
  loadCashSessionTotals
} from '../services/cajaProjection';

export function useCaja() {
  const [cajaActual, setCajaActual] = useState(null);
  const [historialCajas, setHistorialCajas] = useState([]);
  const [movimientosCaja, setMovimientosCaja] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [estadoCaja, setEstadoCaja] = useState('loading');
  const [aperturaPendiente, setAperturaPendiente] = useState(null);

  const [totalesTurno, setTotalesTurno] = useState({
    ventasContado: '0',
    abonosFiado: '0'
  });

  // Cache para cálculos costosos
  const totalesCacheRef = useRef({
    timestamp: 0,
    data: null,
    teoricoTimestamp: 0,
    teoricoData: null
  });

  const CACHE_TTL_MS = 5000; // 5 segundos de caché

  const calcularTotalesSesion = useCallback(async (cashSession, forceRefresh = false, endOverride = null) => {
    if (!cashSession) {
      return { ventasContado: '0', abonosFiado: '0' };
    }

    const now = Date.now();
    const cacheKey = `totales_${cashSession.id}_${endOverride || cashSession.fecha_cierre || 'open'}`;

    // Verificar caché (solo si no es forceRefresh)
    if (!forceRefresh &&
      totalesCacheRef.current.data &&
      totalesCacheRef.current.cacheKey === cacheKey &&
      (now - totalesCacheRef.current.timestamp) < CACHE_TTL_MS) {
      return totalesCacheRef.current.data;
    }

    try {
      const database = await initDB();
      const result = await loadCashSessionTotals(database, cashSession, endOverride);

      // Actualizar caché
      totalesCacheRef.current = {
        ...totalesCacheRef.current,
        timestamp: now,
        data: result,
        cacheKey
      };

      return result;
    } catch (e) {
      Logger.error('Error calculando totales de sesion', e);
      return { ventasContado: '0', abonosFiado: '0' };
    }
  }, []);

  const crearCaja = useCallback(async (openingData) => {
    const database = await initDB();

    return database.transaction('rw', database.table(STORES.CAJAS), async () => {
      const cajasAbiertas = await database.table(STORES.CAJAS)
        .where('estado')
        .equals('abierta')
        .toArray();

      if (cajasAbiertas.length > 0) {
        return cajasAbiertas.sort(
          (a, b) => new Date(b.fecha_apertura || 0) - new Date(a.fecha_apertura || 0)
        )[0];
      }

      const now = new Date().toISOString();
      const caja = {
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
        updatedAt: now
      };

      await database.table(STORES.CAJAS).put(caja);
      return caja;
    });
  }, []);

  const autoAbrirCaja = useCallback(async (montoSugerido = '0', origen = 'policy') => (
    crearCaja(buildAutomaticOpeningData(montoSugerido, origen))
  ), [crearCaja]);

  const obtenerCajaAbiertaMasReciente = useCallback(async () => {
    const db = await initDB();
    const cajasAbiertas = await db.table(STORES.CAJAS)
      .where('estado')
      .equals('abierta')
      .toArray();

    if (cajasAbiertas.length === 0) {
      return null;
    }

    if (cajasAbiertas.length === 1) {
      return cajasAbiertas[0];
    }

    Logger.warn(`[Caja] Se detectaron ${cajasAbiertas.length} cajas abiertas. Iniciando proceso de auto-sanación.`);

    const cajasOrdenadas = cajasAbiertas.sort((a, b) => {
      const tiempoA = new Date(a.fecha_apertura || 0).getTime();
      const tiempoB = new Date(b.fecha_apertura || 0).getTime();
      return tiempoA - tiempoB;
    });

    const cajaActiva = cajasOrdenadas.pop();
    const cajasFantasma = cajasOrdenadas;

    await db.transaction('rw', db.table(STORES.CAJAS), async () => {
      const ceroSeguro = Money.toExactString(Money.init(0));
      for (const caja of cajasFantasma) {
        caja.estado = 'cerrada';
        caja.fecha_cierre = new Date().toISOString();
        caja.monto_cierre = ceroSeguro;
        caja.diferencia = ceroSeguro;
        caja.monto_fondo_siguiente_turno = ceroSeguro;
        caja.comentarios_auditoria = 'Cierre forzado automático: Inconsistencia de sistema (múltiples cajas abiertas).';
        caja.updatedAt = new Date().toISOString();

        await db.table(STORES.CAJAS).put(caja);
      }
    });

    Logger.log(`[Caja] Auto-sanación completada. Se cerraron ${cajasFantasma.length} cajas fantasma.`);

    return cajaActiva;
  }, []);

  const ajustarMontoInicial = async (nuevoMonto) => {
    if (!cajaActual) return;

    const montoSafe = Money.init(nuevoMonto);
    if (montoSafe.lt(0)) {
      showMessageModal('Error: El fondo no puede ser negativo.');
      return;
    }

    try {
      const versionEsperada = cajaActual.updatedAt || cajaActual.fecha_apertura;

      const cajaGuardada = await db.transaction('rw', db.table(STORES.CAJAS), async () => {
        const cajaDb = await db.table(STORES.CAJAS).get(cajaActual.id);
        if (!cajaDb) throw new Error("CRITICAL: La caja no existe.");

        const currentVersion = cajaDb.updatedAt || cajaDb.fecha_apertura;
        if (currentVersion !== versionEsperada) {
          throw new Error("CONCURRENCY_ERROR: Modificación concurrente detectada.");
        }

        cajaDb.monto_inicial = Money.toExactString(montoSafe);
        cajaDb.updatedAt = new Date().toISOString();
        await db.table(STORES.CAJAS).put(cajaDb);
        return cajaDb;
      });

      setCajaActual(cajaGuardada);
      showMessageModal('Fondo inicial ajustado.');
    } catch (error) {
      Logger.error('Error de concurrencia ajustando monto', error);
      showMessageModal(`Error: ${error.message}`);
      await sincronizarEstadoCaja();
    }
  };

  const realizarAuditoriaYCerrar = async (montoFisicoTotal, montoFondoSiguienteTurno, comentarios = '') => {
    if (!cajaActual) return { success: false, error: new Error('No hay caja activa.') };

    try {
      const openingPolicy = getCashOpeningPolicy();
      const montoFisicoSafe = Money.init(montoFisicoTotal);
      const montoFondoSiguienteTurnoSafe = Money.init(montoFondoSiguienteTurno);

      if (montoFisicoSafe.lt(0) || montoFondoSiguienteTurnoSafe.lt(0)) {
        return { success: false, error: new Error('Los montos de auditoria no pueden ser negativos.') };
      }

      if (montoFondoSiguienteTurnoSafe.gt(montoFisicoSafe)) {
        return {
          success: false,
          error: new Error('El fondo del siguiente turno no puede ser mayor al dinero fisico contado.')
        };
      }

      const versionEsperada = cajaActual.updatedAt || cajaActual.fecha_apertura;

      const { diferencia } = await db.transaction(
        'rw',
        [db.table(STORES.CAJAS), db.table(STORES.SALES)],
        async () => {
          const cajaDb = await db.table(STORES.CAJAS).get(cajaActual.id);
          if (!cajaDb) throw new Error("CRITICAL: La caja no existe.");

          const currentVersion = cajaDb.updatedAt || cajaDb.fecha_apertura;
          if (currentVersion !== versionEsperada) {
            throw new Error("CONCURRENCY_ERROR: Operación de cierre abortada. La caja fue modificada externamente.");
          }

          const fechaCierre = new Date().toISOString();
          const { ventasContado, abonosFiado } = await loadCashSessionTotals(
            db,
            cajaDb,
            fechaCierre
          );
          const totalVentasEfectivoSafe = Money.add(ventasContado, abonosFiado);
          const totalTeoricoSafe = Money.subtract(
            Money.add(
              Money.add(cajaDb.monto_inicial || 0, totalVentasEfectivoSafe),
              cajaDb.entradas_efectivo || 0
            ),
            cajaDb.salidas_efectivo || 0
          );
          const diferenciaSafe = Money.subtract(montoFisicoSafe, totalTeoricoSafe);

          const cajaCerradaData = {
            ...cajaDb,
            fecha_cierre: fechaCierre,
            monto_cierre: Money.toExactString(montoFisicoSafe),
            monto_fondo_siguiente_turno: Money.toExactString(montoFondoSiguienteTurnoSafe),
            ventas_efectivo: Money.toExactString(totalVentasEfectivoSafe),
            diferencia: Money.toExactString(diferenciaSafe),
            comentarios_auditoria: comentarios,
            estado: 'cerrada',
            updatedAt: new Date().toISOString(),
            detalle_cierre: {
              ventas_contado: Money.toExactString(ventasContado),
              abonos_fiado: Money.toExactString(abonosFiado),
              total_teorico: Money.toExactString(totalTeoricoSafe)
            }
          };

          await db.table(STORES.CAJAS).put(cajaCerradaData);

          return {
            diferencia: Money.toExactString(diferenciaSafe)
          };
        }
      );

      let nuevaCajaId = null;
      if (openingPolicy === CASH_OPENING_POLICY.AUTOMATIC) {
        try {
          const nuevaCaja = await autoAbrirCaja(
            Money.toExactString(montoFondoSiguienteTurnoSafe),
            'cash_close'
          );
          nuevaCajaId = nuevaCaja.id;
          setCajaActual(nuevaCaja);
          setEstadoCaja('open');
          setAperturaPendiente(null);
        } catch (autoOpenError) {
          Logger.error('La caja se cerro, pero fallo la autoapertura configurada', autoOpenError);
          setCajaActual(null);
          setMovimientosCaja([]);
          setTotalesTurno({ ventasContado: '0', abonosFiado: '0' });
          setEstadoCaja('needs_opening');
          setAperturaPendiente({
            montoSugerido: Money.toExactString(montoFondoSiguienteTurnoSafe),
            ultimaCajaId: cajaActual.id,
            motivo: 'automatic_opening_failed'
          });
        }
      } else {
        setCajaActual(null);
        setMovimientosCaja([]);
        setTotalesTurno({ ventasContado: '0', abonosFiado: '0' });
        setEstadoCaja('needs_opening');
        setAperturaPendiente({
          montoSugerido: Money.toExactString(montoFondoSiguienteTurnoSafe),
          ultimaCajaId: cajaActual.id,
          motivo: 'cash_close'
        });
      }

      return {
        success: true,
        diferencia,
        nuevaCajaId
      };
    } catch (auditError) {
      Logger.error('Error en cierre de caja', auditError);
      return { success: false, error: auditError };
    }
  };

  const registrarMovimiento = async (tipo, monto, concepto) => {
    if (!cajaActual) {
      showMessageModal('Error: No hay caja activa para registrar movimientos.');
      return false;
    }

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

    // VALIDACIÓN ESTRICTA: Verificar disponibilidad real antes de cualquier salida
    const esSalida = tipo === MOVIMIENTO_TIPOS.SALIDA || tipo === MOVIMIENTO_TIPOS.AJUSTE_SALIDA;
    if (esSalida) {
      // Calcular disponibilidad actual REAL (no solo el teórico)
      const totalTeoricoActualSafe = Money.init(await calcularTotalTeorico(true));
      const totalTeoricoPostSalidaSafe = Money.subtract(totalTeoricoActualSafe, montoSafe);

      if (totalTeoricoPostSalidaSafe.lt(0)) {
        showMessageModal(
          `⚠️ Operación bloqueada: La salida de $${Money.toNumber(montoSafe).toFixed(2)} dejaría la caja en $${Money.toNumber(totalTeoricoPostSalidaSafe).toFixed(2)}. ` +
          'No hay fondos suficientes.'
        );
        return false;
      }

      // VALIDACIÓN ADICIONAL: Alerta si la salida supera el 80% del disponible
      const umbralAlerta = Money.multiply(totalTeoricoActualSafe, 0.8);
      if (montoSafe.gt(umbralAlerta)) {
        Logger.warn(
          `[Caja] Salida grande detectada: $${Money.toNumber(montoSafe).toFixed(2)} ` +
          `(80% del disponible: $${Money.toNumber(umbralAlerta).toFixed(2)})`
        );
        // Nota: Solo log, no bloqueamos pero el usuario debería ser consciente
      }
    }

    // VALIDACIÓN DE LÍMITE MÁXIMO: Prevenir acumulación peligrosa de efectivo
    const esEntrada = tipo === MOVIMIENTO_TIPOS.ENTRADA || tipo === MOVIMIENTO_TIPOS.AJUSTE_ENTRADA;
    if (esEntrada) {
      const totalActualSafe = Money.init(await calcularTotalTeorico(true));
      const totalPostEntradaSafe = Money.add(totalActualSafe, montoSafe);

      if (totalPostEntradaSafe.gt(CAJA_CONFIG.MAX_CASH_THRESHOLD)) {
        Logger.warn(
          `[Caja] Alerta: Entrada de $${Money.toNumber(montoSafe).toFixed(2)} ` +
          `supera umbral máximo sugerido de $${CAJA_CONFIG.MAX_CASH_THRESHOLD}. ` +
          'Considere hacer un corte parcial o retiro de seguridad.'
        );
        // Podríamos mostrar un warning al usuario en lugar de bloquear
      }
    }

    try {
      // Delegación al servicio centralizado (Single Source of Truth)
      const { cajaActualizada, movimiento } = await registrarMovimientoCaja(
        cajaActual.id, tipo, Money.toExactString(montoSafe), conceptoLimpio
      );

      setCajaActual(cajaActualizada);
      setMovimientosCaja((prev) => [...prev, movimiento]);

      // Invalidar caché de totales después de un movimiento
      totalesCacheRef.current = { ...totalesCacheRef.current, teoricoTimestamp: 0 };

      return true;

    } catch (movementError) {
      Logger.error('Error registrando movimiento de caja', movementError);

      const isConcurrencyError = movementError.message?.includes('CONCURRENCY_ERROR');
      if (isConcurrencyError) {
        showMessageModal(
          '⚠️ Conflicto de sincronización',
          () => window.location.reload(),
          { type: 'warning', confirmButtonText: 'Recargar y Reintentar' }
        );
      } else {
        showMessageModal(movementError.message || 'Error al registrar el movimiento de caja.', null, { type: 'error' });
      }

      await sincronizarEstadoCaja();
      return false;
    }
  };

  const cargarMovimientos = useCallback(async (cajaActiva) => {
    if (!cajaActiva) return;
    try {
      const database = await initDB();
      const projection = await loadCashSessionProjection(database, cajaActiva);
      setMovimientosCaja(projection.movements);
      setTotalesTurno(projection.totals);
    } catch (loadError) {
      Logger.error('Error cargando movimientos extendidos', loadError);
      setMovimientosCaja([]);
    }
  }, []);

  const cargarEstadoCaja = useCallback(async () => {
    setIsLoading(true);
    setEstadoCaja('loading');
    setError(null);
    try {
      let cajaActiva = await obtenerCajaAbiertaMasReciente();

      const response = await loadDataPaginated(STORES.CAJAS, {
        limit: 20,
        direction: 'prev',
        timeIndex: 'fecha_apertura'
      });

      const cajasRecientes = response?.data || [];
      const ultimaCaja = cajasRecientes.find((c) => c.estado === 'cerrada');

      if (!cajaActiva) {
        const montoSugerido = ultimaCaja
          ? (ultimaCaja.monto_fondo_siguiente_turno ?? ultimaCaja.monto_cierre ?? '0')
          : '0';

        if (getCashOpeningPolicy() === CASH_OPENING_POLICY.AUTOMATIC) {
          Logger.log('[Caja] Autoapertura ejecutada por politica configurada.');
          cajaActiva = await autoAbrirCaja(montoSugerido, 'initial_load');
          cajasRecientes.unshift(cajaActiva);
        } else {
          setCajaActual(null);
          setMovimientosCaja([]);
          setTotalesTurno({ ventasContado: '0', abonosFiado: '0' });
          setAperturaPendiente({
            montoSugerido: Money.toExactString(Money.init(montoSugerido)),
            ultimaCajaId: ultimaCaja?.id || null,
            motivo: ultimaCaja ? 'previous_close' : 'first_opening'
          });
          setEstadoCaja('needs_opening');
          setHistorialCajas(cajasRecientes);
          return;
        }
      }

      setCajaActual(cajaActiva);
      setAperturaPendiente(null);
      setEstadoCaja('open');

      await cargarMovimientos(cajaActiva);

      setHistorialCajas(cajasRecientes.filter((c) => c.id !== cajaActiva.id));
    } catch (loadError) {
      Logger.error('Error al cargar estado de caja:', loadError);
      setError(loadError.message || 'Error al cargar la caja.');
      setEstadoCaja('error');
    } finally {
      setIsLoading(false);
    }
  }, [autoAbrirCaja, cargarMovimientos, obtenerCajaAbiertaMasReciente]);

  useEffect(() => {
    cargarEstadoCaja();
  }, [cargarEstadoCaja]);

  useEffect(() => {
    const handlePolicyChange = () => {
      cargarEstadoCaja();
    };

    window.addEventListener(CASH_OPENING_POLICY_EVENT, handlePolicyChange);
    window.addEventListener('storage', handlePolicyChange);
    return () => {
      window.removeEventListener(CASH_OPENING_POLICY_EVENT, handlePolicyChange);
      window.removeEventListener('storage', handlePolicyChange);
    };
  }, [cargarEstadoCaja]);

  const cajaActualId = cajaActual?.id;
  const cajaActualEstado = cajaActual?.estado;

  useEffect(() => {
    if (!cajaActualId || cajaActualEstado !== 'abierta') return undefined;

    const cashSessionId = cajaActualId;
    const subscription = liveQuery(async () => {
      const database = await initDB();
      const freshCashSession = await database.table(STORES.CAJAS).get(cashSessionId);
      if (!freshCashSession) return null;

      const projection = await loadCashSessionProjection(database, freshCashSession);
      return { freshCashSession, projection };
    }).subscribe({
      next: (result) => {
        if (!result) return;
        setCajaActual(result.freshCashSession);
        setMovimientosCaja(result.projection.movements);
        setTotalesTurno(result.projection.totals);
        totalesCacheRef.current = {
          ...totalesCacheRef.current,
          timestamp: Date.now(),
          data: result.projection.totals,
          cacheKey: `totales_${cashSessionId}_open`,
          teoricoTimestamp: 0
        };
      },
      error: (subscriptionError) => {
        Logger.error('[Caja] Error en proyección reactiva', subscriptionError);
      }
    });

    return () => subscription.unsubscribe();
  }, [cajaActualEstado, cajaActualId]);

  const sincronizarEstadoCaja = useCallback(async () => {
    await cargarEstadoCaja();
  }, [cargarEstadoCaja]);

  const aplicarCajaActiva = useCallback(async (cajaActiva) => {
    if (!cajaActiva) return null;

    setCajaActual(cajaActiva);
    setAperturaPendiente(null);
    setEstadoCaja('open');

    await cargarMovimientos(cajaActiva);

    return cajaActiva;
  }, [cargarMovimientos]);

  const abrirCaja = useCallback(async (openingInput) => {
    try {
      const cajaAbierta = await obtenerCajaAbiertaMasReciente();
      if (cajaAbierta) {
        await aplicarCajaActiva(cajaAbierta);
        return true;
      }

      let montoSugerido = aperturaPendiente?.montoSugerido;
      if (montoSugerido === undefined) {
        const response = await loadDataPaginated(STORES.CAJAS, {
          limit: 20,
          direction: 'prev',
          timeIndex: 'fecha_apertura'
        });
        const ultimaCajaCerrada = (response?.data || []).find((caja) => caja.estado === 'cerrada');
        montoSugerido = ultimaCajaCerrada
          ? (ultimaCajaCerrada.monto_fondo_siguiente_turno ?? ultimaCajaCerrada.monto_cierre ?? '0')
          : '0';
      }

      const openingData = buildManualOpeningData(openingInput, montoSugerido);
      const nuevaCaja = await crearCaja(openingData);
      await aplicarCajaActiva(nuevaCaja);
      setHistorialCajas((prev) => prev.filter((caja) => caja.id !== nuevaCaja.id));
      return true;
    } catch (openError) {
      Logger.error('Error abriendo caja:', openError);
      showMessageModal(openError.message || 'No se pudo abrir la caja.', null, { type: 'error' });
      await sincronizarEstadoCaja();
      return false;
    }
  }, [
    aplicarCajaActiva,
    aperturaPendiente,
    crearCaja,
    obtenerCajaAbiertaMasReciente,
    sincronizarEstadoCaja
  ]);

  const asegurarCajaAbierta = useCallback(async () => {
    try {
      const cajaAbierta = await obtenerCajaAbiertaMasReciente();
      if (cajaAbierta) {
        return aplicarCajaActiva(cajaAbierta);
      }

      const response = await loadDataPaginated(STORES.CAJAS, {
        limit: 20,
        direction: 'prev',
        timeIndex: 'fecha_apertura'
      });
      const ultimaCajaCerrada = (response?.data || []).find((caja) => caja.estado === 'cerrada');
      const montoHeredado = ultimaCajaCerrada
        ? (ultimaCajaCerrada.monto_fondo_siguiente_turno ?? ultimaCajaCerrada.monto_cierre ?? '0')
        : '0';

      if (getCashOpeningPolicy() !== CASH_OPENING_POLICY.AUTOMATIC) {
        const montoSugerido = Money.toExactString(Money.init(montoHeredado));
        setCajaActual(null);
        setAperturaPendiente({
          montoSugerido,
          ultimaCajaId: ultimaCajaCerrada?.id || null,
          motivo: 'operation_requires_cash'
        });
        setEstadoCaja('needs_opening');

        const openingRequiredError = new Error(
          'La caja requiere apertura manual. Confirma el fondo, el conteo y el empleado responsable.'
        );
        openingRequiredError.code = 'CAJA_NEEDS_OPENING';
        throw openingRequiredError;
      }

      const nuevaCaja = await autoAbrirCaja(montoHeredado, 'operation_requires_cash');
      await aplicarCajaActiva(nuevaCaja);
      setHistorialCajas((prev) => [ultimaCajaCerrada, ...prev]
        .filter(Boolean)
        .filter((caja) => caja.id !== nuevaCaja.id));

      return nuevaCaja;
    } catch (ensureError) {
      if (ensureError?.code !== 'CAJA_NEEDS_OPENING') {
        Logger.error('Error asegurando caja abierta:', ensureError);
      }
      await sincronizarEstadoCaja();
      throw ensureError;
    }
  }, [
    aplicarCajaActiva,
    autoAbrirCaja,
    obtenerCajaAbiertaMasReciente,
    sincronizarEstadoCaja
  ]);

  const calcularTotalTeorico = useCallback(async (forceRefresh = false) => {
    if (!cajaActual) return '0';

    const now = Date.now();

    const totalesTurnoKey = `${totalesTurno.ventasContado}_${totalesTurno.abonosFiado}`;

    // Verificar caché primero
    if (!forceRefresh &&
      totalesCacheRef.current.teoricoData &&
      totalesCacheRef.current.teoricoCajaId === cajaActual.id &&
      totalesCacheRef.current.totalesTurnoKey === totalesTurnoKey &&
      (now - totalesCacheRef.current.teoricoTimestamp) < CACHE_TTL_MS) {
      return totalesCacheRef.current.teoricoData;
    }

    try {
      const freshTotales = forceRefresh
        ? await calcularTotalesSesion(cajaActual, true)
        : totalesTurno;

      const inicialSafe = Money.init(cajaActual.monto_inicial || 0);
      const ventasSafe = Money.init(freshTotales.ventasContado || 0);
      const abonosSafe = Money.init(freshTotales.abonosFiado || 0);
      const entradasSafe = Money.init(cajaActual.entradas_efectivo || 0);
      const salidasSafe = Money.init(cajaActual.salidas_efectivo || 0);

      const ingresosTotales = Money.add(
        Money.add(inicialSafe, ventasSafe),
        Money.add(abonosSafe, entradasSafe)
      );
      const totalTeoricoSafe = Money.subtract(ingresosTotales, salidasSafe);

      const result = Money.toExactString(totalTeoricoSafe);

      // Actualizar caché
      totalesCacheRef.current = {
        ...totalesCacheRef.current,
        teoricoTimestamp: now,
        teoricoData: result,
        teoricoCajaId: cajaActual.id,
        totalesTurnoKey
      };

      return result;
    } catch (e) {
      Logger.error('Error calculando total teorico', e);
      return '0';
    }
  }, [cajaActual, totalesTurno, calcularTotalesSesion]);

  // NOTA: calcularTotalesSesion se define antes, así que ya está disponible

  // ============================================================================
  // NUEVAS FUNCIONES UTILITARIAS
  // ============================================================================

  /**
   * Obtiene un resumen estadístico completo del turno actual
   * @returns {Promise<Object>} Resumen con métricas del turno
   */
  const obtenerResumenEstadistico = useCallback(async () => {
    if (!cajaActual) return null;

    const totalTeorico = Money.init(await calcularTotalTeorico());
    const tiempoTranscurrido = Date.now() - new Date(cajaActual.fecha_apertura).getTime();
    const horasTranscurridas = Math.max(tiempoTranscurrido / (1000 * 60 * 60), 0.01); // Mínimo 0.01 horas

    const totalIngresos = Money.add(
      Money.init(cajaActual.monto_inicial || 0),
      Money.add(
        Money.init(totalesTurno.ventasContado || 0),
        Money.add(
          Money.init(totalesTurno.abonosFiado || 0),
          Money.init(cajaActual.entradas_efectivo || 0)
        )
      )
    );

    const totalSalidas = Money.init(cajaActual.salidas_efectivo || 0);
    const flujoNeto = Money.subtract(totalIngresos, totalSalidas);

    // Calcular promedio de ventas por hora
    const ventasPorHora = Money.divide(
      Money.init(totalesTurno.ventasContado || 0),
      horasTranscurridas
    );

    // Obtener conteo de movimientos
    const movimientosEntrada = movimientosCaja.filter(m =>
      m.tipo === 'entrada' || m.tipo === 'ajuste_entrada'
    ).length;
    const movimientosSalida = movimientosCaja.filter(m =>
      m.tipo === 'salida' || m.tipo === 'ajuste_salida'
    ).length;

    return {
      // Estado temporal
      fechaApertura: cajaActual.fecha_apertura,
      tiempoTranscurrido: {
        milisegundos: tiempoTranscurrido,
        horas: (tiempoTranscurrido / (1000 * 60 * 60)).toFixed(2),
        minutos: Math.floor(tiempoTranscurrido / (1000 * 60))
      },
      // Totales
      totalTeorico: Money.toExactString(totalTeorico),
      totalIngresos: Money.toExactString(totalIngresos),
      totalSalidas: Money.toExactString(totalSalidas),
      flujoNeto: Money.toExactString(flujoNeto),
      // Desglose
      fondoInicial: cajaActual.monto_inicial || '0',
      ventasContado: totalesTurno.ventasContado || '0',
      abonosFiado: totalesTurno.abonosFiado || '0',
      entradasExtras: cajaActual.entradas_efectivo || '0',
      // Métricas de rendimiento
      ventasPorHora: Money.toExactString(ventasPorHora),
      ticketPromedioEstimado: Money.toExactString(
        Money.divide(
          Money.init(totalesTurno.ventasContado || 0),
          Math.max(movimientosCaja.length, 1)
        )
      ),
      // Actividad
      totalMovimientos: movimientosCaja.length,
      movimientosEntrada,
      movimientosSalida,
      // Alertas
      alertas: {
        excesoLiquidez: totalTeorico.gt(CAJA_CONFIG.MAX_CASH_THRESHOLD),
        salidasSignificativas: Money.init(cajaActual.salidas_efectivo || 0)
          .gt(Money.multiply(totalIngresos, 0.3)) // Más del 30% de salidas
      }
    };
  }, [cajaActual, totalesTurno, movimientosCaja, calcularTotalTeorico]);

  /**
   * Exporta el reporte del turno actual a CSV
   * @returns {Promise<{success: boolean, blob?: Blob, error?: string}>}
   */
  const exportarReporteCajaCSV = useCallback(async () => {
    if (!cajaActual) {
      return { success: false, error: 'No hay caja activa para exportar' };
    }

    try {
      const resumen = await obtenerResumenEstadistico();
      const fechaCorte = new Date().toISOString().split('T')[0];

      // Construir CSV
      const headers = [
        'Concepto',
        'Valor',
        'Tipo',
        'Notas'
      ];

      const rows = [
        // Información del turno
        ['Fecha Apertura', new Date(cajaActual.fecha_apertura).toLocaleString(), 'info', ''],
        ['Duración', `${resumen.tiempoTranscurrido.horas} horas`, 'info', ''],
        ['Estado', cajaActual.estado, 'info', ''],
        ['', '', '', ''],
        // Totales principales
        ['Fondo Inicial', `$${Money.toNumber(resumen.fondoInicial).toFixed(2)}`, 'ingreso', ''],
        ['Ventas (Contado)', `$${Money.toNumber(resumen.ventasContado).toFixed(2)}`, 'ingreso', ''],
        ['Abonos (Fiado)', `$${Money.toNumber(resumen.abonosFiado).toFixed(2)}`, 'ingreso', 'Créditos recuperados'],
        ['Entradas Extras', `$${Money.toNumber(resumen.entradasExtras).toFixed(2)}`, 'ingreso', ''],
        ['Total Ingresos', `$${Money.toNumber(resumen.totalIngresos).toFixed(2)}`, 'total', ''],
        ['', '', '', ''],
        ['Salidas', `$${Money.toNumber(resumen.totalSalidas).toFixed(2)}`, 'egreso', ''],
        ['Flujo Neto', `$${Money.toNumber(resumen.flujoNeto).toFixed(2)}`, 'total', 'Ingresos - Egresos'],
        ['', '', '', ''],
        ['Total Teórico Caja', `$${Money.toNumber(resumen.totalTeorico).toFixed(2)}`, 'total', ''],
        ['', '', '', ''],
        // Métricas
        ['Ventas por Hora', `$${Money.toNumber(resumen.ventasPorHora).toFixed(2)}`, 'metrica', 'Promedio'],
        ['Ticket Promedio Est.', `$${Money.toNumber(resumen.ticketPromedioEstimado).toFixed(2)}`, 'metrica', 'Estimado'],
        ['Total Movimientos', String(resumen.totalMovimientos), 'metrica', ''],
        ['Movimientos Entrada', String(resumen.movimientosEntrada), 'metrica', ''],
        ['Movimientos Salida', String(resumen.movimientosSalida), 'metrica', ''],
        ['', '', '', ''],
        // Movimientos detallados
        ...movimientosCaja.map(mov => [
          `Movimiento: ${mov.concepto}`,
          `$${Money.toNumber(mov.monto).toFixed(2)}`,
          mov.tipo,
          new Date(mov.fecha).toLocaleString()
        ])
      ];

      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      ].join('\n');

      const blob = new Blob(["\ufeff" + csvContent], {
        type: 'text/csv;charset=utf-8;'
      });

      return {
        success: true,
        blob,
        filename: `reporte_caja_${fechaCorte}_${cajaActual.id.slice(-6)}.csv`
      };
    } catch (error) {
      Logger.error('Error exportando reporte de caja', error);
      return { success: false, error: error.message };
    }
  }, [cajaActual, movimientosCaja, obtenerResumenEstadistico]);

  /**
   * Descarga el reporte CSV directamente
   */
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

  /**
   * Verifica si la caja actual excede el límite máximo de efectivo
   * @returns {boolean} true si excede el límite
   */
  const verificarExcesoLiquidez = useCallback(async () => {
    if (!cajaActual) return false;
    const totalTeorico = Money.init(await calcularTotalTeorico());
    return totalTeorico.gt(CAJA_CONFIG.MAX_CASH_THRESHOLD);
  }, [cajaActual, calcularTotalTeorico]);

  const registrarAjusteCaja = async (montoFisicoReal, comentario) => {
    if (!cajaActual) {
      return { success: false, error: new Error('No hay caja activa para ajustar.') };
    }

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

      const totalTeoricoSafe = Money.init(await calcularTotalTeorico());
      const diferenciaSafe = Money.subtract(montoFisicoRealSafe, totalTeoricoSafe);

      if (diferenciaSafe.eq(0)) {
        return {
          success: true,
          noChange: true,
          diferencia: Money.toExactString(diferenciaSafe)
        };
      }

      const esDiferenciaPositiva = diferenciaSafe.gt(0);
      const tipoAjuste = esDiferenciaPositiva
        ? MOVIMIENTO_TIPOS.AJUSTE_ENTRADA
        : MOVIMIENTO_TIPOS.AJUSTE_SALIDA;

      const montoAjusteSafe = esDiferenciaPositiva ? diferenciaSafe : diferenciaSafe.abs();
      const registrado = await registrarMovimiento(
        tipoAjuste,
        Money.toExactString(montoAjusteSafe),
        comentarioLimpio
      );

      if (!registrado) {
        return { success: false, error: new Error('No se pudo registrar el ajuste en caja.') };
      }

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
  };

  return {
    // Estado
    cajaActual,
    historialCajas,
    movimientosCaja,
    error,
    isLoading,
    estadoCaja,
    aperturaPendiente,
    totalesTurno,
    // Acciones principales
    ajustarMontoInicial,
    abrirCaja,
    asegurarCajaAbierta,
    realizarAuditoriaYCerrar,
    registrarMovimiento,
    calcularTotalTeorico,
    registrarAjusteCaja,
    sincronizarEstadoCaja,
    // Nuevas funciones utilitarias
    obtenerResumenEstadistico,
    exportarReporteCajaCSV,
    descargarReporteCaja,
    verificarExcesoLiquidez,
    // Configuración expuesta para UI
    CAJA_CONFIG
  };
}
