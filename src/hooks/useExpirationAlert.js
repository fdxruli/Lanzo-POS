import { useCallback, useEffect, useState, useMemo } from 'react';
import { getExpiringProductsReport } from '../services/inventoryAnalysis';
import { registerExpirationWaste, registerPartialExpirationWaste } from '../services/wasteService';
import { useInventoryMovement } from '../hooks/useInventoryMovement';
import { useAppStore } from '../store/useAppStore';
import Logger from '../services/Logger';

const STORAGE_KEY = 'ignored_expirations_ttl';
const IGNORE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 horas

/**
 * Hook personalizado para manejar la lógica de alertas de caducidad
 * con persistencia en localStorage y registro de mermas.
 */
export const useExpirationAlert = () => {
  const { updateProductBatch } = useInventoryMovement();
  const companyProfile = useAppStore((state) => state.companyProfile);

  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingItem, setEditingItem] = useState(null);
  const [newDate, setNewDate] = useState('');
  const [processingId, setProcessingId] = useState(null);

  // Leer ignored IDs desde localStorage
  const getIgnoredIds = useCallback(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return new Map();

      const parsed = JSON.parse(stored);
      const now = Date.now();
      const validMap = new Map();

      // Filtrar solo los que no han expirado (24h)
      for (const [id, timestamp] of Object.entries(parsed)) {
        if (now - timestamp < IGNORE_DURATION_MS) {
          validMap.set(id, timestamp);
        }
      }

      // Guardar solo los válidos (limpieza automática)
      const validObject = Object.fromEntries(validMap);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(validObject));

      return validMap;
    } catch (error) {
      Logger.error('Error leyendo ignored_expirations_ttl:', error);
      return new Map();
    }
  }, []);

  // Refresh alerts (declarado antes que handleRestoreAll para evitar TDZ)
  const refreshAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getExpiringProductsReport({ daysThreshold: 45 });

      // Filtrar los ignorados temporalmente
      const ignoredIds = getIgnoredIds();
      const visibleData = data.filter((item) => !ignoredIds.has(item.id));

      setAlerts(visibleData);
    } catch (error) {
      Logger.error('Error cargando reporte de caducidad:', error);
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }, [getIgnoredIds]);

  // Ignorar una alerta por 24 horas
  const handleIgnore = useCallback((id) => {
    try {
      const currentIgnored = getIgnoredIds();
      currentIgnored.set(id, Date.now());

      const ignoredObject = Object.fromEntries(currentIgnored);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ignoredObject));

      // Actualizar estado local para UI reactiva
      setAlerts((prev) => prev.filter((alert) => alert.id !== id));
    } catch (error) {
      Logger.error('Error ignorando alerta:', error);
    }
  }, [getIgnoredIds]);

  // Restaurar todas las alertas ignoradas
  const handleRestoreAll = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      // Recargar alertas
      refreshAlerts();
    } catch (error) {
      Logger.error('Error restaurando alertas:', error);
    }
  }, [refreshAlerts]);

  useEffect(() => {
    const timer = setTimeout(() => {
      refreshAlerts();
    }, 0);

    return () => clearTimeout(timer);
  }, [refreshAlerts]);

  // Mover a merma (registro contable sin eliminar)
  const handleMoveToWaste = useCallback(async (item, isPartial = false, partialQuantity = null) => {
    if (item.type !== 'Lote') {
      return { success: false, error: 'Solo los lotes pueden moverse a merma desde este panel.' };
    }

    setProcessingId(item.id);
    try {
      const product = alerts.find((a) => a.productId === item.productId);
      
      let result;
      if (isPartial && partialQuantity) {
        result = await registerPartialExpirationWaste(
          { ...item, stock: partialQuantity },
          product,
          partialQuantity,
          'Merma parcial desde alerta de caducidad'
        );
      } else {
        result = await registerExpirationWaste(item, product, 'Merma total desde alerta de caducidad');
      }

      if (result.success) {
        await refreshAlerts();
      }

      return result;
    } catch (error) {
      Logger.error('Error moviendo a merma:', error);
      return { success: false, error: error.message };
    } finally {
      setProcessingId(null);
    }
  }, [alerts, refreshAlerts]);

  // Corrección de fecha con fix de timezone
  const openEditModal = useCallback((item) => {
    if (item.type !== 'Lote') {
      return;
    }

    setEditingItem(item);
    
    // FIX: Construir YYYY-MM-DD usando métodos locales para evitar timezone shift
    const dateObj = new Date(item.expiryDate);
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    const formatted = `${year}-${month}-${day}`;
    
    setNewDate(formatted);
  }, []);

  const handleSaveDate = useCallback(async () => {
    if (!editingItem || !newDate) return;

    try {
      await updateProductBatch(editingItem.productId, editingItem.id, { expiryDate: newDate });
      setEditingItem(null);
      await refreshAlerts();
      return { success: true };
    } catch (error) {
      Logger.error('Error actualizando fecha:', error);
      return { success: false, error: error.message };
    }
  }, [editingItem, newDate, refreshAlerts, updateProductBatch]);

  const cancelEdit = useCallback(() => {
    setEditingItem(null);
    setNewDate('');
  }, []);

  // Información contextual por rubro
  const businessContext = useMemo(() => {
    const rawType = companyProfile?.business_type;
    const type = (Array.isArray(rawType) ? rawType[0] : rawType) || 'general';
    const lowerType = type.toLowerCase();

    const isPharmacy = lowerType.includes('farmacia') || lowerType.includes('botica') || lowerType.includes('salud');
    const isFood = lowerType.includes('food') || lowerType.includes('restaurante') || lowerType.includes('cafeteria') || lowerType.includes('alimento');
    const isGrocery = lowerType.includes('abarrotes') || lowerType.includes('tienda') || lowerType.includes('mercado');

    return {
      isPharmacy,
      isFood,
      isGrocery,
      type: lowerType
    };
  }, [companyProfile]);

  // Strategy tip por rubro
  const strategyTip = useMemo(() => {
    const { isPharmacy, isFood, isGrocery } = businessContext;

    if (isPharmacy) {
      return {
        icon: 'pill',
        title: 'Protocolo Farmacéutico',
        text: 'Revisa políticas de devolución y separa antibióticos caducados (SINGREM).'
      };
    }
    if (isFood) {
      return {
        icon: 'chef-hat',
        title: 'Estrategia "Cero Desperdicio"',
        text: 'Prioriza estos ingredientes en "Especiales del Día" o procésalos hoy.'
      };
    }
    if (isGrocery) {
      return {
        icon: 'tag',
        title: 'Liquidación',
        text: 'Arma packs de ahorro o 2x1. Mejor recuperar algo hoy que perder todo mañana.'
      };
    }
    return {
      icon: 'lightbulb',
      title: 'Sugerencia',
      text: 'Etiqueta con "Últimas Piezas". Verifica cambios con proveedor.'
    };
  }, [businessContext]);

  const ignoredCount = useMemo(() => {
    return getIgnoredIds().size;
  }, [getIgnoredIds]);

  return {
    // Estado
    alerts,
    loading,
    editingItem,
    newDate,
    processingId,
    ignoredCount,
    
    // Contexto
    businessContext,
    strategyTip,
    
    // Acciones
    refreshAlerts,
    handleIgnore,
    handleRestoreAll,
    handleMoveToWaste,
    openEditModal,
    handleSaveDate,
    cancelEdit,
    setNewDate
  };
};
