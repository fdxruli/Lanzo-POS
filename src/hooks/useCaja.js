// src/hooks/useCaja.js
import { useState, useEffect, useCallback } from 'react';
import { showMessageModal, generateID } from '../services/utils';
import { loadDataPaginated, saveDataSafe, STORES, initDB } from '../services/db/index';
import Logger from '../services/Logger';
import { Money } from '../utils/moneyMath';

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
        if (sale.fulfillmentStatus === 'cancelled') continue;

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
      es_auto_apertura: true
    };

    const result = await saveDataSafe(STORES.CAJAS, nuevaCaja);
    if (!result.success) throw result.error;
    return nuevaCaja;
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

  const ajustarMontoInicial = async (nuevoMonto) => {
    if (!cajaActual) return;

    const montoSafe = Money.init(nuevoMonto);
    if (montoSafe.lt(0)) {
      showMessageModal('Error: El fondo no puede ser negativo.');
      return;
    }

    const cajaActualizada = { ...cajaActual, monto_inicial: Money.toExactString(montoSafe) };
    const result = await saveDataSafe(STORES.CAJAS, cajaActualizada);

    if (result.success) {
      setCajaActual(cajaActualizada);
      showMessageModal('Fondo inicial ajustado.');
    } else {
      showMessageModal(`Error: ${result.error?.message}`);
    }
  };

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

      const cajaCerrada = {
        ...cajaActual,
        fecha_cierre: new Date().toISOString(),
        monto_cierre: Money.toExactString(montoFisicoSafe),
        monto_fondo_siguiente_turno: Money.toExactString(montoFondoSiguienteTurnoSafe),
        ventas_efectivo: Money.toExactString(totalVentasEfectivoSafe),
        diferencia: Money.toExactString(diferenciaSafe),
        comentarios_auditoria: comentarios,
        estado: 'cerrada',
        detalle_cierre: {
          ventas_contado: Money.toExactString(ventasContado),
          abonos_fiado: Money.toExactString(abonosFiado),
          total_teorico: Money.toExactString(totalTeoricoSafe)
        }
      };

      const result = await saveDataSafe(STORES.CAJAS, cajaCerrada);
      if (!result.success) return { success: false, error: result.error };

      const nuevaCaja = await autoAbrirCaja(Money.toExactString(montoFondoSiguienteTurnoSafe));

      return {
        success: true,
        diferencia: Money.toExactString(diferenciaSafe),
        nuevaCajaId: nuevaCaja.id
      };
    } catch (auditError) {
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

    const movimiento = {
      id: `mov-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      caja_id: cajaActual.id,
      tipo,
      monto: Money.toExactString(montoSafe),
      concepto: conceptoLimpio,
      fecha: new Date().toISOString()
    };

    try {
      const movResult = await saveDataSafe(STORES.MOVIMIENTOS_CAJA, movimiento);
      if (!movResult.success) {
        showMessageModal(movResult.error.message);
        return false;
      }

      const cajaActualizada = { ...cajaActual };
      const esEntrada = tipo === MOVIMIENTO_TIPOS.ENTRADA || tipo === MOVIMIENTO_TIPOS.AJUSTE_ENTRADA;

      if (esEntrada) {
        const currentEntradas = Money.init(cajaActualizada.entradas_efectivo || 0);
        cajaActualizada.entradas_efectivo = Money.toExactString(Money.add(currentEntradas, montoSafe));
      } else {
        const currentSalidas = Money.init(cajaActualizada.salidas_efectivo || 0);
        cajaActualizada.salidas_efectivo = Money.toExactString(Money.add(currentSalidas, montoSafe));
      }

      const cajaResult = await saveDataSafe(STORES.CAJAS, cajaActualizada);
      if (!cajaResult.success) {
        showMessageModal(`Error: ${cajaResult.error.message}`);
        return false;
      }

      setCajaActual(cajaActualizada);
      setMovimientosCaja((prev) => [...prev, movimiento]);
      return true;
    } catch (movementError) {
      Logger.error('Error registrando movimiento de caja', movementError);
      showMessageModal('Error al registrar el movimiento de caja.');
      return false;
    }
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
