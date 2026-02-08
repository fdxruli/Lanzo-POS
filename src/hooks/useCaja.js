// src/hooks/useCaja.js
import { useState, useEffect, useCallback } from 'react';
import { showMessageModal, roundCurrency, generateID } from '../services/utils';
// Aseguramos la importación correcta desde index
import { loadDataPaginated, saveDataSafe, STORES, initDB } from '../services/db/index';
import Logger from '../services/Logger';

export function useCaja() {
  const [cajaActual, setCajaActual] = useState(null);
  const [historialCajas, setHistorialCajas] = useState([]);
  const [movimientosCaja, setMovimientosCaja] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Estado desglosado para el turno
  const [totalesTurno, setTotalesTurno] = useState({
    ventasContado: 0,
    abonosFiado: 0
  });

  // --- REFACTORIZADO A DEXIE (Corrección del error mode.replace) ---
  const calcularTotalesSesion = async (fechaApertura) => {
    try {
      const db = await initDB();
      
      // Usamos where().aboveOrEqual() en lugar de IDBKeyRange manual
      const sales = await db.table(STORES.SALES)
        .where('timestamp')
        .aboveOrEqual(fechaApertura)
        .toArray();

      let contado = 0;
      let abonos = 0;

      for (const sale of sales) {
        if (sale.fulfillmentStatus === 'cancelled') continue;
        
        if (sale.paymentMethod === 'efectivo') {
          contado += (sale.total || 0);
        } else if (sale.paymentMethod === 'fiado') {
          abonos += (sale.abono || 0);
        }
      }

      return {
        ventasContado: roundCurrency(contado),
        abonosFiado: roundCurrency(abonos)
      };

    } catch (e) {
      Logger.error("Error calculando totales sesión", e);
      return { ventasContado: 0, abonosFiado: 0 };
    }
  };

  // --- LÓGICA DE APERTURA INTELIGENTE ---
  const autoAbrirCaja = async (ultimaCajaCerrada) => {
    const montoHeredado = ultimaCajaCerrada ? ultimaCajaCerrada.monto_cierre : 0;

    const nuevaCaja = {
      id: generateID('caja'),
      fecha_apertura: new Date().toISOString(),
      monto_inicial: montoHeredado, 
      estado: 'abierta',
      fecha_cierre: null,
      monto_cierre: null,
      ventas_efectivo: 0,
      entradas_efectivo: 0,
      salidas_efectivo: 0,
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
      // 1. Traer últimas cajas
      const cajasRecientes = await loadDataPaginated(STORES.CAJAS, {
        limit: 20,
        direction: 'prev' // De la más nueva a la más vieja
      });

      let cajaActiva = cajasRecientes.find(c => c.estado === 'abierta');
      const ultimaCaja = cajasRecientes.find(c => c.estado === 'cerrada'); // La última cerrada

      // 2. SI NO HAY CAJA ABIERTA -> LA CREAMOS AUTOMÁTICAMENTE
      if (!cajaActiva) {
        Logger.log("🔄 Sistema inteligente: Iniciando nuevo turno automáticamente...");
        cajaActiva = await autoAbrirCaja(ultimaCaja);
        // Actualizamos la lista local añadiendo la nueva al principio
        cajasRecientes.unshift(cajaActiva);
      }

      // 3. Cargar datos de la caja activa
      setCajaActual(cajaActiva);
      
      // Esperamos a cargar movimientos y totales
      await Promise.all([
          cargarMovimientos(cajaActiva.id),
          calcularTotalesSesion(cajaActiva.fecha_apertura).then(setTotalesTurno)
      ]);

      // Historial (excluyendo la actual)
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

  // --- REFACTORIZADO A DEXIE ---
  const cargarMovimientos = async (cajaId) => {
    try {
      const db = await initDB();
      // Búsqueda simple por índice con Dexie
      const movimientos = await db.table(STORES.MOVIMIENTOS_CAJA)
        .where('caja_id').equals(cajaId)
        .toArray();
        
      setMovimientosCaja(movimientos || []);
    } catch (error) {
      Logger.error("Error cargando movimientos", error);
      setMovimientosCaja([]);
    }
  };

  // Permite editar el monto inicial si el automático no era correcto
  const ajustarMontoInicial = async (nuevoMonto) => {
    if (!cajaActual) return;
    const cajaActualizada = { ...cajaActual, monto_inicial: parseFloat(nuevoMonto) };

    const result = await saveDataSafe(STORES.CAJAS, cajaActualizada);

    if (result.success) {
      setCajaActual(cajaActualizada);
      showMessageModal("✅ Fondo inicial ajustado.");
    } else {
      const msg = result.error?.message || "No se pudo actualizar el fondo.";
      showMessageModal(`Error: ${msg}`);
    }
  };

  const calcularTotalTeorico = async () => {
    if (!cajaActual) return 0;
    const { ventasContado, abonosFiado } = totalesTurno;
    const ingresos = roundCurrency(
      cajaActual.monto_inicial +
      (ventasContado || 0) +
      (abonosFiado || 0) +
      (cajaActual.entradas_efectivo || 0)
    );
    const total = roundCurrency(ingresos - (cajaActual.salidas_efectivo || 0));
    return total;
  }

  const realizarAuditoriaYCerrar = async (montoFisico, comentarios = '') => {
    if (!cajaActual) return false;
    try {
      const totalTeorico = await calcularTotalTeorico();
      const diferencia = montoFisico - totalTeorico;
      const { ventasContado, abonosFiado } = await calcularTotalesSesion(cajaActual.fecha_apertura);

      const cajaCerrada = {
        ...cajaActual,
        fecha_cierre: new Date().toISOString(),
        monto_cierre: parseFloat(montoFisico),
        ventas_efectivo: ventasContado + abonosFiado,
        diferencia: diferencia,
        comentarios_auditoria: comentarios,
        estado: 'cerrada',
        detalle_cierre: { ventas_contado: ventasContado, abonos_fiado: abonosFiado, total_teorico: totalTeorico }
      };

      const result = await saveDataSafe(STORES.CAJAS, cajaCerrada);
      if (!result.success) {
        return { success: false, error: result.error };
      }

      await cargarEstadoCaja();

      return { success: true, diferencia };
    } catch (error) {
      return { success: false, error };
    }
  };

  const registrarMovimiento = async (tipo, monto, concepto) => {
    if (!cajaActual) return false;
    const movimiento = {
      id: `mov-${Date.now()}`,
      caja_id: cajaActual.id,
      tipo: tipo,
      monto: parseFloat(monto),
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
      if (tipo === 'entrada') cajaActualizada.entradas_efectivo += movimiento.monto;
      else cajaActualizada.salidas_efectivo += movimiento.monto;

      const cajaResult = await saveDataSafe(STORES.CAJAS, cajaActualizada);
      if (!cajaResult.success) {
        showMessageModal("El movimiento se guardo pero no se pudo actualizar el total en caja; " + cajaResult.error.message);
        return false;
      }
      setCajaActual(cajaActualizada);
      setMovimientosCaja(prev => [...prev, movimiento]);
      return true;
    } catch (error) { return false; }
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
    calcularTotalTeorico
  };
}