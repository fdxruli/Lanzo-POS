// src/hooks/useCaja.js
import { useState, useEffect, useCallback } from 'react';
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

  const calcularTotalesSesion = async (fechaApertura) => {
    try {
      const db = await initDB();

      const sales = await db.table(STORES.SALES)
        .where('timestamp')
        .aboveOrEqual(fechaApertura)
        .toArray();

      let contadoSafe = Money.init(0);
      let abonosSafe = Money.init(0);

      for (const sale of sales) {
        if (!isFinanciallyClosedSale(sale)) continue;

        if (sale.paymentMethod === 'efectivo') {
          contadoSafe = Money.add(contadoSafe, sale.total || 0);
        } else if (sale.paymentMethod === 'fiado') {
          abonosSafe = Money.add(abonosSafe, sale.abono || 0);
        }
      }

      return {
        ventasContado: Money.toExactString(contadoSafe),
        abonosFiado: Money.toExactString(abonosSafe)
      };
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
    if (!cajaActual) return false;

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

    const esSalida = tipo === MOVIMIENTO_TIPOS.SALIDA || tipo === MOVIMIENTO_TIPOS.AJUSTE_SALIDA;
    if (esSalida) {
      const totalTeoricoActualSafe = Money.init(await calcularTotalTeorico());
      const totalTeoricoPostSalidaSafe = Money.subtract(totalTeoricoActualSafe, montoSafe);

      if (totalTeoricoPostSalidaSafe.lt(0)) {
        showMessageModal('Operacion bloqueada: la salida dejaria el total teorico en negativo.');
        return false;
      }
    }

    try {
      const versionEsperada = cajaActual.updatedAt || cajaActual.fecha_apertura;
      const esEntrada = tipo === MOVIMIENTO_TIPOS.ENTRADA || tipo === MOVIMIENTO_TIPOS.AJUSTE_ENTRADA;

      const movimientoId = `mov-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const movimiento = {
        id: movimientoId,
        caja_id: cajaActual.id,
        tipo,
        monto: Money.toExactString(montoSafe),
        concepto: conceptoLimpio,
        fecha: new Date().toISOString()
      };

      const cajaGuardada = await db.transaction('rw', [db.table(STORES.CAJAS), db.table(STORES.MOVIMIENTOS_CAJA)], async () => {
        const cajaDb = await db.table(STORES.CAJAS).get(cajaActual.id);
        if (!cajaDb) throw new Error("CRITICAL: La caja no existe.");

        const currentVersion = cajaDb.updatedAt || cajaDb.fecha_apertura;
        if (currentVersion !== versionEsperada) {
          throw new Error("CONCURRENCY_ERROR: La caja fue modificada por otra operación.");
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

      setCajaActual(cajaGuardada);
      setMovimientosCaja((prev) => [...prev, movimiento]);
      return true;

    } catch (movementError) {
      Logger.error('Error registrando movimiento de caja', movementError);
      showMessageModal(movementError.message || 'Error al registrar el movimiento de caja.');
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

  const calcularTotalTeorico = async () => {
    if (!cajaActual) return '0';

    const inicialSafe = Money.init(cajaActual.monto_inicial || 0);
    const ventasSafe = Money.init(totalesTurno.ventasContado || 0);
    const abonosSafe = Money.init(totalesTurno.abonosFiado || 0);
    const entradasSafe = Money.init(cajaActual.entradas_efectivo || 0);
    const salidasSafe = Money.init(cajaActual.salidas_efectivo || 0);

    const ingresosTotales = Money.add(Money.add(inicialSafe, ventasSafe), Money.add(abonosSafe, entradasSafe));
    const totalTeoricoSafe = Money.subtract(ingresosTotales, salidasSafe);

    return Money.toExactString(totalTeoricoSafe);
  };

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
    cajaActual,
    historialCajas,
    movimientosCaja,
    error,
    isLoading,
    totalesTurno,
    ajustarMontoInicial,
    realizarAuditoriaYCerrar,
    registrarMovimiento,
    calcularTotalTeorico,
    registrarAjusteCaja,
    sincronizarEstadoCaja
  };
}
