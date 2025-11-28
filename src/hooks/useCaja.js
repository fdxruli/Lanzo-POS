// src/hooks/useCaja.js
import { useState, useEffect, useCallback } from 'react';
import { loadData, saveData, STORES, initDB } from '../services/database';
import { showMessageModal, roundCurrency } from '../services/utils';

export function useCaja() {
  const [cajaActual, setCajaActual] = useState(null);
  const [historialCajas, setHistorialCajas] = useState([]);
  const [movimientosCaja, setMovimientosCaja] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [montoSugerido, setMontoSugerido] = useState(0);

  // Estado desglosado para el turno
  const [totalesTurno, setTotalesTurno] = useState({
    ventasContado: 0,
    abonosFiado: 0
  });

  // --- HELPER OPTIMIZADO: Suma con Cursor (Memoria Constante O(1)) ---
  const calcularTotalesSesion = async (fechaApertura) => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORES.SALES], 'readonly');
      const store = tx.objectStore(STORES.SALES);
      const index = store.index('timestamp');

      // Rango: Desde que se abrió la caja hasta el infinito (futuro)
      const range = IDBKeyRange.lowerBound(fechaApertura);
      const request = index.openCursor(range);

      let contado = 0;
      let abonos = 0;

      request.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          const sale = cursor.value;
          if (sale.fulfillmentStatus !== 'cancelled') {
            if (sale.paymentMethod === 'efectivo') {
              contado = roundCurrency(contado + (sale.total || 0));
            } else if (sale.paymentMethod === 'fiado') {
              abonos = roundCurrency(abonos + (sale.abono || 0));
            }
          }
          cursor.continue();
        } else {
          // Fin del cursor: devolvemos los totales acumulados
          resolve({ ventasContado: contado, abonosFiado: abonos });
        }
      };
      request.onerror = (e) => reject(e.target.error);
    });
  };

  // --- CARGA INICIAL ---
  const cargarEstadoCaja = useCallback(async () => {
    setIsLoading(true);
    try {
      const todasLasCajas = await loadData(STORES.CAJAS);

      // 1. Buscar caja abierta
      let cajaAbierta = todasLasCajas.find(c => c.estado === 'abierta');

      // 2. Buscar último cierre para sugerir monto
      const cajasCerradas = todasLasCajas
        .filter(c => c.estado === 'cerrada')
        .sort((a, b) => new Date(b.fecha_cierre) - new Date(a.fecha_cierre));

      if (cajasCerradas.length > 0) {
        setMontoSugerido(cajasCerradas[0].monto_cierre);
      }

      if (cajaAbierta) {
        setCajaActual(cajaAbierta);
        await cargarMovimientos(cajaAbierta.id);

        // USAMOS LA NUEVA FUNCIÓN OPTIMIZADA
        const totales = await calcularTotalesSesion(cajaAbierta.fecha_apertura);
        setTotalesTurno(totales);

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
        const request = index.getAll(cajaId); // Los movimientos son pocos, getAll está bien
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve([]);
      });
      setMovimientosCaja(movimientos);
    } catch (error) {
      console.error("Error al cargar movimientos:", error);
      setMovimientosCaja([]);
    }
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
      ventas_efectivo: 0,
      entradas_efectivo: 0,
      salidas_efectivo: 0,
      diferencia: null
    };

    try {
      await saveData(STORES.CAJAS, nuevaCaja);
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

  // --- CÁLCULO DEL TOTAL TEÓRICO (OPTIMIZADO) ---
  const calcularTotalTeorico = async () => {
    if (!cajaActual) return 0;

    // 1. Extraemos los valores del estado 'totalesTurno' que ya calculaste previamente
    const { ventasContado, abonosFiado } = totalesTurno;

    // 2. Sumamos todo lo que entró (Inicio + Ventas efectivo + Abonos de deuda + Entradas manuales)
    const ingresos = roundCurrency(
      cajaActual.monto_inicial +
      (ventasContado || 0) +
      (abonosFiado || 0) +
      (cajaActual.entradas_efectivo || 0)
    );

    // 3. Restamos las salidas manuales
    const total = roundCurrency(ingresos - (cajaActual.salidas_efectivo || 0));

    return total;
  }

  // --- CIERRE DE CAJA (OPTIMIZADO) ---
  const realizarAuditoriaYCerrar = async (montoFisico, comentarios = '') => {
    if (!cajaActual) return false;

    try {
      const totalTeorico = await calcularTotalTeorico();
      const diferencia = montoFisico - totalTeorico;

      // Obtenemos los totales finales una última vez
      const { ventasContado, abonosFiado } = await calcularTotalesSesion(cajaActual.fecha_apertura);

      const cajaCerrada = {
        ...cajaActual,
        fecha_cierre: new Date().toISOString(),
        monto_cierre: parseFloat(montoFisico),
        ventas_efectivo: ventasContado + abonosFiado, // Guardamos el total histórico
        diferencia: diferencia,
        comentarios_auditoria: comentarios,
        estado: 'cerrada',
        detalle_cierre: {
          ventas_contado: ventasContado,
          abonos_fiado: abonosFiado,
          total_teorico: totalTeorico
        }
      };

      await saveData(STORES.CAJAS, cajaCerrada);

      // Limpieza de estado
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

      const cajaActualizada = { ...cajaActual };
      if (tipo === 'entrada') cajaActualizada.entradas_efectivo += movimiento.monto;
      else cajaActualizada.salidas_efectivo += movimiento.monto;

      await saveData(STORES.CAJAS, cajaActualizada);

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
    totalesTurno,
    abrirCaja,
    realizarAuditoriaYCerrar,
    registrarMovimiento,
    calcularTotalTeorico
  };
}