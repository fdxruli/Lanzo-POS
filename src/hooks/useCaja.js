// src/hooks/useCaja.js
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { showMessageModal, generateID } from '../services/utils';
import { loadDataPaginated, saveDataSafe, STORES, initDB, db } from '../services/db/index';
import Logger from '../services/Logger';
import { Money } from '../utils/moneyMath';
import { isFinanciallyClosedSale } from '../services/sales/financialStats';

const MOVIMIENTO_TIPOS = {
  ENTRADA: 'entrada',
  SALIDA: 'salida',
  AJUSTE_ENTRADA: 'ajuste_entrada',
  AJUSTE_SALIDA: 'ajuste_salida'
};

// Configuración de límites y retry
const CAJA_CONFIG = {
  MAX_CASH_THRESHOLD: 50000, // Límite máximo sugerido en caja (configurable)
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY_MS: 300,
  CONCURRENCY_ERROR_MESSAGE: 'La caja fue modificada por otra transacción. Recarga e intenta de nuevo.'
};

// Helper para delay en retry
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Función de retry con backoff exponencial
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
        Logger.warn(`[Caja] ${context}: Error de concurrencia no reintentable`);
        throw error;
      }
      
      if (attempt < maxAttempts) {
        const delayMs = CAJA_CONFIG.RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        Logger.warn(`[Caja] ${context}: Reintento ${attempt + 1}/${maxAttempts} en ${delayMs}ms`);
        await delay(delayMs);
      }
    }
  }
  
  throw lastError;
};

export function useCaja() {
  const [cajaActual, setCajaActual] = useState(null);
  const [historialCajas, setHistorialCajas] = useState([]);
  const [movimientosCaja, setMovimientosCaja] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

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

  const calcularTotalesSesion = async (fechaApertura, forceRefresh = false) => {
    const now = Date.now();
    const cacheKey = `totales_${fechaApertura}`;
    
    // Verificar caché (solo si no es forceRefresh)
    if (!forceRefresh && 
        totalesCacheRef.current.data && 
        totalesCacheRef.current.cacheKey === cacheKey &&
        (now - totalesCacheRef.current.timestamp) < CACHE_TTL_MS) {
      return totalesCacheRef.current.data;
    }

    try {
      const db = await initDB();

      // OPTIMIZACIÓN: Usar índice de timestamp con rango específico
      // en lugar de cargar todas las ventas y filtrar
      const sales = await db.table(STORES.SALES)
        .where('timestamp')
        .between(fechaApertura, new Date().toISOString(), true, true)
        .toArray();

      let contadoSafe = Money.init(0);
      let abonosSafe = Money.init(0);

      // OPTIMIZACIÓN: Procesamiento en paralelo con reducción de iteraciones
      for (const sale of sales) {
        // Filtro temprano para evitar procesamiento innecesario
        if (!isFinanciallyClosedSale(sale)) continue;

        const method = sale.paymentMethod;
        if (method === 'efectivo') {
          contadoSafe = Money.add(contadoSafe, sale.total || 0);
        } else if (method === 'fiado') {
          abonosSafe = Money.add(abonosSafe, sale.abono || 0);
        }
        // Ignorar otros métodos de pago para totales de efectivo
      }

      const result = {
        ventasContado: Money.toExactString(contadoSafe),
        abonosFiado: Money.toExactString(abonosSafe)
      };

      // Actualizar caché
      totalesCacheRef.current = {
        timestamp: now,
        data: result,
        cacheKey
      };

      return result;
    } catch (e) {
      Logger.error('Error calculando totales de sesion', e);
      return { ventasContado: '0', abonosFiado: '0' };
    }
  };

  const autoAbrirCaja = async (montoFondoSiguienteTurno = '0') => {
    const montoInicialSafe = Money.init(montoFondoSiguienteTurno || 0);

    if (montoInicialSafe.lt(0)) {
      throw new Error('No se puede abrir una caja con monto inicial negativo.');
    }

    const nuevaCaja = {
      id: generateID('caja'),
      fecha_apertura: new Date().toISOString(),
      monto_inicial: Money.toExactString(montoInicialSafe),
      estado: 'abierta',
      fecha_cierre: null,
      monto_cierre: null,
      ventas_efectivo: '0',
      entradas_efectivo: '0',
      salidas_efectivo: '0',
      diferencia: null,
      es_auto_apertura: true,
      updatedAt: new Date().toISOString() // Sello de versión inicial
    };

    const result = await saveDataSafe(STORES.CAJAS, nuevaCaja);
    if (!result.success) throw result.error;
    return nuevaCaja;
  };

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
      const montoFisicoSafe = Money.init(montoFisicoTotal);
      const montoFondoSiguienteTurnoSafe = Money.init(montoFondoSiguienteTurno);
      const totalTeoricoSafe = Money.init(await calcularTotalTeorico());

      if (montoFisicoSafe.lt(0) || montoFondoSiguienteTurnoSafe.lt(0)) {
        return { success: false, error: new Error('Los montos de auditoria no pueden ser negativos.') };
      }

      if (montoFondoSiguienteTurnoSafe.gt(montoFisicoSafe)) {
        return {
          success: false,
          error: new Error('El fondo del siguiente turno no puede ser mayor al dinero fisico contado.')
        };
      }

      const diferenciaSafe = Money.subtract(montoFisicoSafe, totalTeoricoSafe);
      const { ventasContado, abonosFiado } = await calcularTotalesSesion(cajaActual.fecha_apertura);
      const totalVentasEfectivoSafe = Money.add(ventasContado, abonosFiado);

      const versionEsperada = cajaActual.updatedAt || cajaActual.fecha_apertura;

      const { nuevaCajaId } = await db.transaction('rw', db.table(STORES.CAJAS), async () => {
        const cajaDb = await db.table(STORES.CAJAS).get(cajaActual.id);
        if (!cajaDb) throw new Error("CRITICAL: La caja no existe.");

        const currentVersion = cajaDb.updatedAt || cajaDb.fecha_apertura;
        if (currentVersion !== versionEsperada) {
          throw new Error("CONCURRENCY_ERROR: Operación de cierre abortada. La caja fue modificada externamente.");
        }

        const cajaCerradaData = {
          ...cajaDb,
          fecha_cierre: new Date().toISOString(),
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

        const nuevaCajaIdGen = generateID('caja');
        const nuevaCaja = {
          id: nuevaCajaIdGen,
          fecha_apertura: new Date().toISOString(),
          monto_inicial: Money.toExactString(montoFondoSiguienteTurnoSafe),
          estado: 'abierta',
          fecha_cierre: null,
          monto_cierre: null,
          ventas_efectivo: '0',
          entradas_efectivo: '0',
          salidas_efectivo: '0',
          diferencia: null,
          es_auto_apertura: true,
          updatedAt: new Date().toISOString()
        };

        await db.table(STORES.CAJAS).put(nuevaCaja);

        return { nuevaCajaId: nuevaCajaIdGen };
      });

      return {
        success: true,
        diferencia: Money.toExactString(diferenciaSafe),
        nuevaCajaId: nuevaCajaId
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
      // INTENTO CON RETRY para operaciones transaccionales
      const versionEsperada = cajaActual.updatedAt || cajaActual.fecha_apertura;
      const movimientoId = `mov-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const movimiento = {
        id: movimientoId,
        caja_id: cajaActual.id,
        tipo,
        monto: Money.toExactString(montoSafe),
        concepto: conceptoLimpio,
        fecha: new Date().toISOString()
      };

      const cajaGuardada = await retryWithBackoff(async () => {
        return await db.transaction('rw', [db.table(STORES.CAJAS), db.table(STORES.MOVIMIENTOS_CAJA)], async () => {
          const cajaDb = await db.table(STORES.CAJAS).get(cajaActual.id);
          if (!cajaDb) {
            throw new Error("CRITICAL: La caja no existe en la base de datos.");
          }

          const currentVersion = cajaDb.updatedAt || cajaDb.fecha_apertura;
          if (currentVersion !== versionEsperada) {
            throw new Error("CONCURRENCY_ERROR: La caja fue modificada por otra operación. Por favor recarga e intenta de nuevo.");
          }

          if (esEntrada) {
            const currentEntradas = Money.init(cajaDb.entradas_efectivo || 0);
            cajaDb.entradas_efectivo = Money.toExactString(Money.add(currentEntradas, montoSafe));
          } else {
            const currentSalidas = Money.init(cajaDb.salidas_efectivo || 0);
            cajaDb.salidas_efectivo = Money.toExactString(Money.add(currentSalidas, montoSafe));
          }

          cajaDb.updatedAt = new Date().toISOString();
          await db.table(STORES.CAJAS).put(cajaDb);
          await db.table(STORES.MOVIMIENTOS_CAJA).put(movimiento);

          return cajaDb;
        });
      }, CAJA_CONFIG.RETRY_ATTEMPTS, `registrarMovimiento ${tipo} $${Money.toNumber(montoSafe).toFixed(2)}`);

      setCajaActual(cajaGuardada);
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

  const cargarMovimientos = async (cajaId) => {
    try {
      const db = await initDB();
      const movimientos = await db.table(STORES.MOVIMIENTOS_CAJA)
        .where('caja_id').equals(cajaId)
        .toArray();
      setMovimientosCaja(movimientos || []);
    } catch (loadError) {
      Logger.error('Error cargando movimientos', loadError);
      setMovimientosCaja([]);
    }
  };

  const cargarEstadoCaja = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await loadDataPaginated(STORES.CAJAS, {
        limit: 20,
        direction: 'prev',
        timeIndex: 'fecha_apertura'
      });

      const cajasRecientes = response?.data || [];
      let cajaActiva = cajasRecientes.find((c) => c.estado === 'abierta');
      const ultimaCaja = cajasRecientes.find((c) => c.estado === 'cerrada');

      if (!cajaActiva) {
        Logger.log('Sistema inteligente: Iniciando nuevo turno automaticamente.');

        const montoHeredado = ultimaCaja
          ? (ultimaCaja.monto_fondo_siguiente_turno ?? ultimaCaja.monto_cierre ?? '0')
          : '0';

        cajaActiva = await autoAbrirCaja(montoHeredado);
        cajasRecientes.unshift(cajaActiva);
      }

      setCajaActual(cajaActiva);

      await Promise.all([
        cargarMovimientos(cajaActiva.id),
        calcularTotalesSesion(cajaActiva.fecha_apertura).then(setTotalesTurno)
      ]);

      setHistorialCajas(cajasRecientes.filter((c) => c.id !== cajaActiva.id));
    } catch (loadError) {
      Logger.error('Error al cargar estado de caja:', loadError);
      setError(loadError.message || 'Error al cargar la caja.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    cargarEstadoCaja();
  }, [cargarEstadoCaja]);

  const sincronizarEstadoCaja = useCallback(async () => {
    await cargarEstadoCaja();
  }, [cargarEstadoCaja]);

  const calcularTotalTeorico = useCallback(async (forceRefresh = false) => {
    if (!cajaActual) return '0';

    const now = Date.now();

    // Verificar caché primero
    if (!forceRefresh &&
        totalesCacheRef.current.teoricoData &&
        totalesCacheRef.current.teoricoCajaId === cajaActual.id &&
        (now - totalesCacheRef.current.teoricoTimestamp) < CACHE_TTL_MS) {
      return totalesCacheRef.current.teoricoData;
    }

    try {
      // Forzar refresh de totales si se solicita
      if (forceRefresh) {
        await calcularTotalesSesion(cajaActual.fecha_apertura, true);
      }

      const inicialSafe = Money.init(cajaActual.monto_inicial || 0);
      const ventasSafe = Money.init(totalesTurno.ventasContado || 0);
      const abonosSafe = Money.init(totalesTurno.abonosFiado || 0);
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
        teoricoCajaId: cajaActual.id
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
    totalesTurno,
    // Acciones principales
    ajustarMontoInicial,
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
