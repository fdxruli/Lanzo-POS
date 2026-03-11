// src/hooks/useCaja.js
import { useState, useEffect, useCallback } from 'react';
import { showMessageModal, generateID } from '../services/utils';
import { loadDataPaginated, saveDataSafe, STORES, initDB } from '../services/db/index';
import Logger from '../services/Logger';
import { Money } from '../utils/moneyMath'; // <-- OBLIGATORIO

export function useCaja() {
  const [cajaActual, setCajaActual] = useState(null);
  const [historialCajas, setHistorialCajas] = useState([]);
  const [movimientosCaja, setMovimientosCaja] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const [totalesTurno, setTotalesTurno] = useState({
    ventasContado: "0",
    abonosFiado: "0"
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
      Logger.error("Error calculando totales sesión", e);
      return { ventasContado: "0", abonosFiado: "0" };
    }
  };

  const autoAbrirCaja = async (ultimaCajaCerrada) => {
    // Heredamos el cierre anterior seguro, o "0"
    const montoHeredado = ultimaCajaCerrada ? ultimaCajaCerrada.monto_cierre : "0";

    const nuevaCaja = {
      id: generateID('caja'),
      fecha_apertura: new Date().toISOString(),
      monto_inicial: Money.toExactString(montoHeredado), // BLINDADO
      estado: 'abierta',
      fecha_cierre: null,
      monto_cierre: null,
      ventas_efectivo: "0",
      entradas_efectivo: "0",
      salidas_efectivo: "0",
      diferencia: null,
      es_auto_apertura: true
    };

    const result = await saveDataSafe(STORES.CAJAS, nuevaCaja);
    if (!result.success) throw result.error;
    return nuevaCaja;
  };

  const cargarEstadoCaja = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await loadDataPaginated(STORES.CAJAS, {
        limit: 20,
        direction: 'prev',
        timeIndex: 'fecha_apertura'
      });

      // Extracción segura del array
      const cajasRecientes = response?.data || [];
      let cajaActiva = cajasRecientes.find(c => c.estado === 'abierta');
      const ultimaCaja = cajasRecientes.find(c => c.estado === 'cerrada');

      if (!cajaActiva) {
        Logger.log("🔄 Sistema inteligente: Iniciando nuevo turno automáticamente...");
        cajaActiva = await autoAbrirCaja(ultimaCaja);
        cajasRecientes.unshift(cajaActiva);
      }

      setCajaActual(cajaActiva);

      await Promise.all([
        cargarMovimientos(cajaActiva.id),
        calcularTotalesSesion(cajaActiva.fecha_apertura).then(setTotalesTurno)
      ]);

      setHistorialCajas(cajasRecientes.filter(c => c.id !== cajaActiva.id));

    } catch (error) {
      Logger.error("Error al cargar estado de caja:", error);
      setError(error.message || "Error al cargar la caja.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    cargarEstadoCaja();
  }, [cargarEstadoCaja]);

  const cargarMovimientos = async (cajaId) => {
    try {
      const db = await initDB();
      const movimientos = await db.table(STORES.MOVIMIENTOS_CAJA)
        .where('caja_id').equals(cajaId)
        .toArray();
      setMovimientosCaja(movimientos || []);
    } catch (error) {
      Logger.error("Error cargando movimientos", error);
      setMovimientosCaja([]);
    }
  };

  const ajustarMontoInicial = async (nuevoMonto) => {
    if (!cajaActual) return;

    const montoSafe = Money.init(nuevoMonto);
    if (montoSafe.lt(0)) return showMessageModal("Error: El fondo no puede ser negativo.");

    const cajaActualizada = { ...cajaActual, monto_inicial: Money.toExactString(montoSafe) };
    const result = await saveDataSafe(STORES.CAJAS, cajaActualizada);

    if (result.success) {
      setCajaActual(cajaActualizada);
      showMessageModal("✅ Fondo inicial ajustado.");
    } else {
      showMessageModal(`Error: ${result.error?.message}`);
    }
  };

  const calcularTotalTeorico = async () => {
    if (!cajaActual) return "0";

    // Sumamos todo estrictamente
    const inicialSafe = Money.init(cajaActual.monto_inicial || 0);
    const ventasSafe = Money.init(totalesTurno.ventasContado || 0);
    const abonosSafe = Money.init(totalesTurno.abonosFiado || 0);
    const entradasSafe = Money.init(cajaActual.entradas_efectivo || 0);
    const salidasSafe = Money.init(cajaActual.salidas_efectivo || 0);

    const ingresosTotales = Money.add(Money.add(inicialSafe, ventasSafe), Money.add(abonosSafe, entradasSafe));
    const totalTeoricoSafe = Money.subtract(ingresosTotales, salidasSafe);

    return Money.toExactString(totalTeoricoSafe);
  };

  const realizarAuditoriaYCerrar = async (montoFisico, comentarios = '') => {
    if (!cajaActual) return false;
    try {
      const montoFisicoSafe = Money.init(montoFisico);
      const totalTeoricoSafe = Money.init(await calcularTotalTeorico());

      const diferenciaSafe = Money.subtract(montoFisicoSafe, totalTeoricoSafe);
      const { ventasContado, abonosFiado } = await calcularTotalesSesion(cajaActual.fecha_apertura);

      const totalVentasEfectivoSafe = Money.add(ventasContado, abonosFiado);

      const cajaCerrada = {
        ...cajaActual,
        fecha_cierre: new Date().toISOString(),
        monto_cierre: Money.toExactString(montoFisicoSafe),
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

      await cargarEstadoCaja();
      return { success: true, diferencia: Money.toExactString(diferenciaSafe) };
    } catch (error) {
      return { success: false, error };
    }
  };

  const registrarMovimiento = async (tipo, monto, concepto) => {
    if (!cajaActual) return false;

    const montoSafe = Money.init(monto);
    if (montoSafe.lte(0)) {
      showMessageModal("El monto debe ser mayor a 0.");
      return false;
    }

    const movimiento = {
      id: `mov-${Date.now()}`,
      caja_id: cajaActual.id,
      tipo: tipo,
      monto: Money.toExactString(montoSafe),
      concepto: concepto.trim(),
      fecha: new Date().toISOString()
    };

    try {
      const movResult = await saveDataSafe(STORES.MOVIMIENTOS_CAJA, movimiento);
      if (!movResult.success) {
        showMessageModal(movResult.error.message);
        return false;
      }

      const cajaActualizada = { ...cajaActual };

      if (tipo === 'entrada') {
        const currentEntradas = Money.init(cajaActualizada.entradas_efectivo || 0);
        cajaActualizada.entradas_efectivo = Money.toExactString(Money.add(currentEntradas, montoSafe));
      } else {
        const currentSalidas = Money.init(cajaActualizada.salidas_efectivo || 0);
        cajaActualizada.salidas_efectivo = Money.toExactString(Money.add(currentSalidas, montoSafe));
      }

      const cajaResult = await saveDataSafe(STORES.CAJAS, cajaActualizada);
      if (!cajaResult.success) {
        showMessageModal("Error: " + cajaResult.error.message);
        return false;
      }

      setCajaActual(cajaActualizada);
      setMovimientosCaja(prev => [...prev, movimiento]);
      return true;
    } catch (error) { return false; }
  };

  return {
    cajaActual, historialCajas, movimientosCaja, error, isLoading,
    totalesTurno, ajustarMontoInicial, realizarAuditoriaYCerrar,
    registrarMovimiento, calcularTotalTeorico
  };
}