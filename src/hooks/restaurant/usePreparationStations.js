import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { preparationStationsRepository } from '../../services/restaurant/preparationStationsRepository';
import {
  getLicenseKeyFromDetails,
  isPreparationStationsEnabled
} from '../../services/sync/syncConstants';
import { useSettingsAccess, useSettingsActionGuard } from '../../services/auth/useSettingsAccess';

export function usePreparationStations({ includeInactive = false, autoLoad = true } = {}) {
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const settingsAccess = useSettingsAccess();
  const captureSettingsAction = useSettingsActionGuard();

  const licenseKey = getLicenseKeyFromDetails(licenseDetails);
  const isDynamicStationsEnabled = Boolean(
    licenseDetails &&
    licenseDetails.valid !== false &&
    isPreparationStationsEnabled(licenseDetails)
  );
  const hasManagePermission = settingsAccess.isAdmin
    || settingsAccess.canAccessPermission('settings_controls')
    || settingsAccess.canAccessPermission('products');
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

  const captureManagementAction = useCallback(() => {
    if (!canManageStations) {
      throw new Error('Tu plan o permisos actuales no permiten gestionar areas de preparacion.');
    }
    const permission = settingsAccess.isAdmin
      || settingsAccess.canAccessPermission('settings_controls')
      ? 'settings_controls'
      : 'products';
    const actorHandle = captureSettingsAction(permission);
    actorHandle.assertCurrent(permission);
    return { actorHandle, permission };
  }, [canManageStations, captureSettingsAction, settingsAccess]);

  const createStation = useCallback(async ({ name }) => {
    const { actorHandle, permission } = captureManagementAction();
    const response = await preparationStationsRepository.upsertPreparationStation({
      licenseKey,
      station: { name }
    });
    actorHandle.assertCurrent(permission);
    await refreshStations({ force: true });
    actorHandle.assertCurrent(permission);
    return response;
  }, [captureManagementAction, licenseKey, refreshStations]);

  const updateStation = useCallback(async (station, updates = {}) => {
    const { actorHandle, permission } = captureManagementAction();
    const response = await preparationStationsRepository.upsertPreparationStation({
      licenseKey,
      station: {
        ...station,
        ...updates,
        id: station.id
      },
      expectedVersion: station.serverVersion || null
    });
    actorHandle.assertCurrent(permission);
    await refreshStations({ force: true });
    actorHandle.assertCurrent(permission);
    return response;
  }, [captureManagementAction, licenseKey, refreshStations]);

  const toggleStation = useCallback(async (station, isActive) => {
    const { actorHandle, permission } = captureManagementAction();
    const response = await preparationStationsRepository.togglePreparationStation({
      licenseKey,
      stationId: station.id,
      isActive,
      expectedVersion: station.serverVersion || null
    });
    actorHandle.assertCurrent(permission);
    await refreshStations({ force: true });
    actorHandle.assertCurrent(permission);
    return response;
  }, [captureManagementAction, licenseKey, refreshStations]);

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
