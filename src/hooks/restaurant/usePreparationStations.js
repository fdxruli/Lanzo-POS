import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { preparationStationsRepository } from '../../services/restaurant/preparationStationsRepository';
import {
  getLicenseKeyFromDetails,
  isPreparationStationsEnabled
} from '../../services/sync/syncConstants';

export function usePreparationStations({ includeInactive = false, autoLoad = true } = {}) {
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const canAccess = useAppStore((state) => state.canAccess);
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);

  const licenseKey = getLicenseKeyFromDetails(licenseDetails);
  const isDynamicStationsEnabled = Boolean(
    licenseDetails &&
    licenseDetails.valid !== false &&
    isPreparationStationsEnabled(licenseDetails)
  );
  const hasManagePermission = currentDeviceRole !== 'staff' || canAccess('settings') || canAccess('products');
  const canManageStations = isDynamicStationsEnabled && hasManagePermission;

  const [stations, setStations] = useState(() => preparationStationsRepository.getFallbackPreparationStations());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [source, setSource] = useState('fallback');

  const refreshStations = useCallback(async ({ force = false } = {}) => {
    setIsLoading(true);
    try {
      const result = await preparationStationsRepository.getPreparationStations({
        licenseKey,
        includeInactive,
        force,
        useCloud: isDynamicStationsEnabled
      });

      setStations(result.stations);
      setSource(result.source || 'cloud');
      setError(result.success === false ? (result.message || 'No se pudieron actualizar las areas.') : null);
      return result;
    } catch (refreshError) {
      setError(refreshError?.message || 'No se pudieron cargar las areas.');
      const fallback = preparationStationsRepository.getFallbackPreparationStations();
      setStations(fallback);
      setSource('fallback');
      return { success: false, stations: fallback, error: refreshError };
    } finally {
      setIsLoading(false);
    }
  }, [includeInactive, isDynamicStationsEnabled, licenseKey]);

  useEffect(() => {
    if (!autoLoad) return;
    refreshStations();
  }, [autoLoad, refreshStations]);

  const activeStations = useMemo(() => {
    const active = stations.filter((station) => station.isActive !== false);
    return active.length > 0 ? active : preparationStationsRepository.getFallbackPreparationStations();
  }, [stations]);

  const assertCanManage = useCallback(() => {
    if (!canManageStations) {
      throw new Error('Tu plan o permisos actuales no permiten gestionar areas de preparacion.');
    }
  }, [canManageStations]);

  const createStation = useCallback(async ({ name }) => {
    assertCanManage();
    const response = await preparationStationsRepository.upsertPreparationStation({
      licenseKey,
      station: { name }
    });
    await refreshStations({ force: true });
    return response;
  }, [assertCanManage, licenseKey, refreshStations]);

  const updateStation = useCallback(async (station, updates = {}) => {
    assertCanManage();
    const response = await preparationStationsRepository.upsertPreparationStation({
      licenseKey,
      station: {
        ...station,
        ...updates,
        id: station.id
      },
      expectedVersion: station.serverVersion || null
    });
    await refreshStations({ force: true });
    return response;
  }, [assertCanManage, licenseKey, refreshStations]);

  const toggleStation = useCallback(async (station, isActive) => {
    assertCanManage();
    const response = await preparationStationsRepository.togglePreparationStation({
      licenseKey,
      stationId: station.id,
      isActive,
      expectedVersion: station.serverVersion || null
    });
    await refreshStations({ force: true });
    return response;
  }, [assertCanManage, licenseKey, refreshStations]);

  return {
    stations,
    activeStations,
    isLoading,
    error,
    source,
    canManageStations,
    isDynamicStationsEnabled,
    refreshStations,
    createStation,
    updateStation,
    toggleStation
  };
}

export default usePreparationStations;
