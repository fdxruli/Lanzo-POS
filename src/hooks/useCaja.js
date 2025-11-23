// src/hooks/useCaja.js
import { useState, useEffect, useCallback } from 'react';
import { loadData, saveData, STORES, initDB } from '../services/database';
import { showMessageModal } from '../services/utils';

export function useCaja() {
  const [cajaActual, setCajaActual] = useState(null);
  const [historialCajas, setHistorialCajas] = useState([]);
  const [movimientosCaja, setMovimientosCaja] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [montoSugerido, setMontoSugerido] = useState(0);

  // NUEVO: Estado desglosado para el turno
  const [totalesTurno, setTotalesTurno] = useState({
    ventasContado: 0, // Dinero de ventas pagadas al 100% en efectivo
    abonosFiado: 0    // Dinero recibido como anticipo en ventas a crédito
  });

  const cargarEstadoCaja = useCallback(async () => {
    setIsLoading(true);
    try {
      const todasLasCajas = await loadData(STORES.CAJAS);

      // 1. Buscar caja abierta
      let cajaAbierta = todasLasCajas.find(c => c.estado === 'abierta');

      // 2. Lógica inteligente: Buscar el último cierre para sugerir monto
      const cajasCerradas = todasLasCajas
        .filter(c => c.estado === 'cerrada')
        .sort((a, b) => new Date(b.fecha_cierre) - new Date(a.fecha_cierre)); // La más reciente primero

      if (cajasCerradas.length > 0) {
        setMontoSugerido(cajasCerradas[0].monto_cierre);
      }

      if (cajaAbierta) {
        setCajaActual(cajaAbierta);
        await cargarMovimientos(cajaAbierta.id);

        // --- LÓGICA DE CÁLCULO DE VENTAS (CONTADO vs FIADO) ---
        const todasVentas = await loadData(STORES.SALES);
        const ventasSesion = await cargarVentasDeSesion(cajaAbierta.fecha_apertura);

        let contado = 0;
        let abonos = 0;

        ventasSesion.forEach(v => {
          if (v.paymentMethod === 'efectivo') {
            contado += (v.total || 0);
          } else if (v.paymentMethod === 'fiado') {
            // Solo sumamos lo que realmente entró a la caja (el abono inicial)
            abonos += (v.abono || 0);
          }
        });

        setTotalesTurno({ ventasContado: contado, abonosFiado: abonos });
        // ------------------------------------------------------

      } else {
        setCajaActual(null);
        setMovimientosCaja([]);
        setTotalesTurno({ ventasContado: 0, abonosFiado: 0 });
      }

      setHistorialCajas(cajasCerradas);

    } catch (error) {
      console.error("Error al cargar estado de caja:", error);
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
      const transaction = db.transaction(STORES.MOVIMIENTOS_CAJA, 'readonly');
      const store = transaction.objectStore(STORES.MOVIMIENTOS_CAJA);
      const index = store.index('caja_id');
      const movimientos = await new Promise(resolve => {
        const request = index.getAll(cajaId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve([]);
      });
      setMovimientosCaja(movimientos);
    } catch (error) {
      console.error("Error al cargar movimientos:", error);
      setMovimientosCaja([]);
    }
  };

  const cargarVentasDeSesion = async (fechaApertura) => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORES.SALES], 'readonly');
      const store = tx.objectStore(STORES.SALES);
      const index = store.index('timestamp'); // Asegúrate de que este índice existe en database.js

      // RANGO: Desde fechaApertura hasta el futuro
      const range = IDBKeyRange.lowerBound(fechaApertura);
      const request = index.getAll(range);

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = (e) => reject(e.target.error);
    });
  };

  const abrirCaja = async (monto_inicial) => {
    if (cajaActual) {
      showMessageModal('Ya existe una caja abierta.');
      return false;
    }
    const montoFinal = (monto_inicial !== undefined && monto_inicial !== null)
      ? parseFloat(monto_inicial)
      : montoSugerido;

    const nuevaCaja = {
      id: `caja-${Date.now()}`,
      fecha_apertura: new Date().toISOString(),
      monto_inicial: montoFinal,
      estado: 'abierta',
      fecha_cierre: null,
      monto_cierre: null,
      ventas_efectivo: 0, // Se actualizará al cerrar
      entradas_efectivo: 0,
      salidas_efectivo: 0,
      diferencia: null
    };

    try {
      await saveData(STORES.CAJAS, nuevaCaja);

      // Actualizamos estado local manualmente para respuesta rápida
      setCajaActual(nuevaCaja);
      setMovimientosCaja([]);
      setTotalesTurno({ ventasContado: 0, abonosFiado: 0 });

      showMessageModal(`Caja abierta con $${montoFinal.toFixed(2)}`);
      return true;
    } catch (error) {
      console.error('Error al abrir la caja:', error);
      return false;
    }
  };

  // --- CÁLCULO DEL TOTAL ESPERADO EN CAJA ---
  const calcularTotalTeorico = async () => {
    if (!cajaActual) return 0;

    // Recalcular ventas de esta sesión directamente desde la DB por seguridad
    const todasVentas = await loadData(STORES.SALES);
    const ventasSesion = await cargarVentasDeSesion(cajaAbierta.fecha_apertura);

    let ingresoPorVentas = 0;
    ventasSesion.forEach(v => {
      if (v.paymentMethod === 'efectivo') {
        ingresoPorVentas += (v.total || 0);
      } else if (v.paymentMethod === 'fiado') {
        ingresoPorVentas += (v.abono || 0);
      }
    });

    // Fórmula: Inicial + (Ventas + Abonos) + EntradasManuales - SalidasManuales
    return cajaActual.monto_inicial + ingresoPorVentas + cajaActual.entradas_efectivo - cajaActual.salidas_efectivo;
  }

  /**
   * Cerrar Caja con Auditoría
   * @param {number} montoFisico - Lo que el usuario cuenta en billetes/monedas
   * @param {string} comentarios - Justificación si no cuadra
   */
  const realizarAuditoriaYCerrar = async (montoFisico, comentarios = '') => {
    if (!cajaActual) return false;

    try {
      const totalTeorico = await calcularTotalTeorico();
      const diferencia = montoFisico - totalTeorico;

      // Calculamos los totales finales para guardarlos en el registro histórico
      // (Aunque ya tenemos totalTeorico, es bueno guardar el desglose)
      const todasVentas = await loadData(STORES.SALES);
      const ventasSesion = todasVentas.filter(v =>
        new Date(v.timestamp) >= new Date(cajaActual.fecha_apertura)
      );

      let ventasEfectivoFinal = 0;
      let abonosFiadoFinal = 0;

      ventasSesion.forEach(v => {
        if (v.paymentMethod === 'efectivo') ventasEfectivoFinal += v.total;
        else if (v.paymentMethod === 'fiado') abonosFiadoFinal += (v.abono || 0);
      });

      const cajaCerrada = {
        ...cajaActual,
        fecha_cierre: new Date().toISOString(),
        monto_cierre: parseFloat(montoFisico),
        ventas_efectivo: ventasEfectivoFinal + abonosFiadoFinal, // Total ingresos por ventas
        diferencia: diferencia,
        comentarios_auditoria: comentarios,
        estado: 'cerrada',
        // Guardamos detalle extra para futuros reportes
        detalle_cierre: {
          ventas_contado: ventasEfectivoFinal,
          abonos_fiado: abonosFiadoFinal,
          total_teorico: totalTeorico
        }
      };

      await saveData(STORES.CAJAS, cajaCerrada);

      // Limpiamos el estado
      setCajaActual(null);
      setMovimientosCaja([]);
      setHistorialCajas([cajaCerrada, ...historialCajas]);
      setTotalesTurno({ ventasContado: 0, abonosFiado: 0 });

      return { success: true, diferencia };

    } catch (error) {
      console.error('Error en auditoría:', error);
      return { success: false, error };
    }
  };

  const registrarMovimiento = async (tipo, monto, concepto) => {
    if (!cajaActual) {
      showMessageModal('No hay una caja abierta para registrar movimientos.');
      return false;
    }

    const movimiento = {
      id: `mov-${Date.now()}`,
      caja_id: cajaActual.id,
      tipo: tipo,
      monto: parseFloat(monto),
      concepto: concepto.trim(),
      fecha: new Date().toISOString()
    };

    try {
      await saveData(STORES.MOVIMIENTOS_CAJA, movimiento);

      // Actualizamos la caja en DB
      const cajaActualizada = { ...cajaActual };
      if (tipo === 'entrada') cajaActualizada.entradas_efectivo += movimiento.monto;
      else cajaActualizada.salidas_efectivo += movimiento.monto;

      await saveData(STORES.CAJAS, cajaActualizada);

      // Actualizamos estado local
      setCajaActual(cajaActualizada);
      setMovimientosCaja(prev => [...prev, movimiento]);

      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  };

  return {
    cajaActual,
    historialCajas,
    movimientosCaja,
    isLoading,
    montoSugerido,
    totalesTurno, // ¡IMPORTANTE! Exponemos el desglose (contado vs fiado)
    abrirCaja,
    realizarAuditoriaYCerrar,
    registrarMovimiento,
    calcularTotalTeorico
  };
}