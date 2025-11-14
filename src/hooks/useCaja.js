// src/hooks/useCaja.js
import { useState, useEffect, useCallback } from 'react';
// Importamos toda la lógica pura de la base de datos
import { loadData, saveData, STORES, initDB } from '../services/database';
// Importamos tu modal de mensajes
import { showMessageModal } from '../services/utils';

/**
 * Este es tu nuevo 'caja.js', pero en formato de Hook.
 * Manejará todo el estado y la lógica de la caja.
 */
export function useCaja() {
  // 1. ESTADO (Tus antiguas variables globales)
  const [cajaActual, setCajaActual] = useState(null);
  const [historialCajas, setHistorialCajas] = useState([]);
  const [movimientosCaja, setMovimientosCaja] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // 2. LÓGICA DE CARGA (Tu antiguo 'validarCaja' y 'renderCajaStatus')
  // 'useCallback' evita que esta función se cree en cada render
  const cargarEstadoCaja = useCallback(async () => {
    setIsLoading(true);

    try {
      // 1. Validar caja abierta (lógica de 'validarCaja')
      const todasLasCajas = await loadData(STORES.CAJAS);
      let cajaAbierta = todasLasCajas.find(c => c.estado === 'abierta');
      
      if (cajaAbierta) {
        // Lógica de pendiente de cierre
        const ahora = new Date();
        const fechaApertura = new Date(cajaAbierta.fecha_apertura);
        const horasAbierta = (ahora - fechaApertura) / (1000 * 60 * 60);

        if (horasAbierta > 16) {
          cajaAbierta.estado = 'pendiente_cierre';
          await saveData(STORES.CAJAS, cajaAbierta);
          showMessageModal('La caja ha estado abierta por más de 16 horas. Debes cerrarla.');
        }
        
        setCajaActual(cajaAbierta);
        // Cargar movimientos de la caja abierta
        await cargarMovimientos(cajaAbierta.id);

      } else {
        setCajaActual(null);
        setMovimientosCaja([]);
      }

      // 2. Cargar historial
      const cajasCerradas = todasLasCajas
        .filter(c => c.estado === 'cerrada')
        .sort((a, b) => new Date(b.fecha_apertura) - new Date(a.fecha_apertura));
      setHistorialCajas(cajasCerradas);

    } catch (error) {
      console.error("Error al cargar estado de caja:", error);
    } finally {
      setIsLoading(false);
    }
  }, []); // useCallback con [] significa que la función nunca cambia.

  // 3. EFECTO INICIAL (Tu antiguo 'initCajaModule')
  // Se ejecuta una sola vez cuando el hook se usa por primera vez.
  useEffect(() => {
    cargarEstadoCaja();
  }, [cargarEstadoCaja]); // Se ejecuta cuando 'cargarEstadoCaja' se define

  /**
   * Carga los movimientos de la caja actual
   */
  const cargarMovimientos = async (cajaId) => {
    // Esta lógica estaba en tu 'renderCajaStatus'
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

  // 4. ACCIONES (Las funciones que tu página llamará)

  /**
   * Abre una nueva caja
   * Lógica de 'abrirCaja'
   */
  const abrirCaja = async (monto_inicial) => {
    if (isNaN(monto_inicial) || monto_inicial < 0) {
      showMessageModal('El monto inicial no es válido.');
      return false;
    }
    if (cajaActual) {
      showMessageModal('Ya existe una caja abierta.');
      return false;
    }

    const nuevaCaja = {
      id: `caja-${Date.now()}`,
      fecha_apertura: new Date().toISOString(),
      monto_inicial: parseFloat(monto_inicial),
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
      setCajaActual(nuevaCaja); // Actualiza el estado
      setMovimientosCaja([]); // Limpia movimientos
      showMessageModal(`Caja abierta con $${monto_inicial.toFixed(2)}`);
      return true;
    } catch (error) {
      console.error('Error al abrir la caja:', error);
      return false;
    }
  };

  /**
   * Cierra la caja actual
   * Lógica de 'cerrarCaja'
   */
  const cerrarCaja = async (monto_cierre) => {
    if (!cajaActual) {
      showMessageModal('No hay una caja abierta para cerrar.');
      return false;
    }
    if (isNaN(monto_cierre) || monto_cierre < 0) {
      showMessageModal('El monto de cierre no es válido.');
      return false;
    }

    try {
      // (Aquí iría la lógica de calcular ventas, etc.)
      // Por ahora, solo cerramos
      const ventas = await loadData(STORES.SALES); // Cargar ventas
      const ventasDeSesion = ventas.filter(v => new Date(v.timestamp) >= new Date(cajaActual.fecha_apertura));
      const ventas_efectivo = ventasDeSesion.reduce((sum, v) => sum + v.total, 0); // Asumimos todo efectivo

      const total_teorico = cajaActual.monto_inicial + ventas_efectivo + cajaActual.entradas_efectivo - cajaActual.salidas_efectivo;
      const diferencia = monto_cierre - total_teorico;

      const cajaCerrada = {
        ...cajaActual,
        fecha_cierre: new Date().toISOString(),
        monto_cierre: parseFloat(monto_cierre),
        ventas_efectivo: ventas_efectivo,
        diferencia: diferencia,
        estado: 'cerrada',
      };

      await saveData(STORES.CAJAS, cajaCerrada);
      
      // Actualizamos el estado
      setCajaActual(null);
      setMovimientosCaja([]);
      setHistorialCajas([cajaCerrada, ...historialCajas]); // Añadir al historial
      
      showMessageModal(`Caja cerrada. Diferencia: $${diferencia.toFixed(2)}`);
      return true;

    } catch (error) {
      console.error('Error al cerrar la caja:', error);
      return false;
    }
  };

  /**
   * Registra una entrada o salida
   * Lógica de 'registrarMovimientoCaja'
   */
  const registrarMovimiento = async (tipo, monto, concepto) => {
    if (!cajaActual) {
      showMessageModal('No hay una caja abierta.');
      return false;
    }
    // ... (validaciones de monto y concepto)

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
      
      // Actualizamos el estado de la caja actual
      const cajaActualizada = { ...cajaActual };
      if (tipo === 'entrada') {
        cajaActualizada.entradas_efectivo += movimiento.monto;
      } else {
        cajaActualizada.salidas_efectivo += movimiento.monto;
      }
      
      await saveData(STORES.CAJAS, cajaActualizada);
      
      // Actualizamos el estado en React
      setCajaActual(cajaActualizada);
      setMovimientosCaja([...movimientosCaja, movimiento]);
      
      showMessageModal(`Movimiento de ${tipo} registrado.`);
      return true;
    } catch (error) {
      console.error(`Error al registrar ${tipo}:`, error);
      return false;
    }
  };

  // 5. RETORNO
  // Exponemos el estado y las funciones que la página necesita
  return {
    cajaActual,
    historialCajas,
    movimientosCaja,
    isLoading,
    abrirCaja,
    cerrarCaja,
    registrarMovimiento,
  };
}