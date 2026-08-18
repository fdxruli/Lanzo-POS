// src/components/common/DeviceManager.jsx
import { useCallback, useEffect, useState } from 'react';
import './DeviceManager.css';
import { getLicenseDevicesSmart, deactivateDeviceSmart } from '../../services/licenseService';
import { setDeviceModeSmart } from '../../services/deviceModeService';
import {
  DEVICE_MODE_OPTIONS,
  deviceModeAllowsActor,
  getDeviceModeLabel,
  resolveDeviceMode
} from '../../services/deviceModePolicy';
import { showConfirmModal, showMessageModal } from '../../services/utils';
import { useAppStore } from '../../store/useAppStore';

export default function DeviceManager({ licenseKey }) {
  const logout = useAppStore((state) => state.logout);
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
  const [devices, setDevices] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isOfflineData, setIsOfflineData] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [modeUpdatingDeviceId, setModeUpdatingDeviceId] = useState(null);

  const fetchDevices = useCallback(async (silent = false) => {
    if (!licenseKey) return;

    if (!silent) setIsLoading(true);
    setError(null);

    try {
      const result = await getLicenseDevicesSmart(licenseKey);

      if (result.success) {
        setDevices(result.data);
        setIsOfflineData(result.source === 'cache');
        setLastUpdated(result.lastUpdated);
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [licenseKey]);

  useEffect(() => {
    const handleOnline = () => {
      showMessageModal('Conexion restaurada. Sincronizando...', null, { type: 'success' });
      fetchDevices(true);
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [fetchDevices]);

  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  const handleModeChange = async (device, nextMode) => {
    const currentMode = resolveDeviceMode(device);
    if (!nextMode || nextMode === currentMode) return;

    if (currentDeviceRole === 'staff') {
      showMessageModal('Solo una sesion Admin puede cambiar el modo de un dispositivo.', null, { type: 'error' });
      return;
    }

    if (!navigator.onLine) {
      showMessageModal('Se requiere internet para cambiar el modo del dispositivo.', null, { type: 'error' });
      return;
    }

    const isCurrentDevice = Boolean(device.is_current_device);
    const nextLabel = getDeviceModeLabel(nextMode);
    const currentLabel = getDeviceModeLabel(currentMode);
    const sessionWarning = isCurrentDevice && nextMode === 'staff_only'
      ? '\n\nEste es el dispositivo actual. Al dejarlo como Solo Staff, la sesion Admin actual se cerrara y deberas iniciar sesion Staff.'
      : '';

    if (!(await showConfirmModal(
      `Cambiar ${device.device_name || 'este dispositivo'} de ${currentLabel} a ${nextLabel}?${sessionWarning}`,
      {
        title: 'Cambiar modo del dispositivo',
        confirmButtonText: 'Cambiar modo',
        cancelButtonText: 'Cancelar'
      }
    ))) return;

    setModeUpdatingDeviceId(device.device_id);
    try {
      const result = await setDeviceModeSmart(device.device_id, nextMode, licenseKey);

      if (!result?.success) {
        showMessageModal(
          result?.message || result?.code || 'No se pudo cambiar el modo del dispositivo.',
          null,
          { type: 'error' }
        );
        return;
      }

      showMessageModal(`Modo actualizado: ${getDeviceModeLabel(result.device_mode || nextMode)}.`);

      if (result.requester_session_revoked) {
        await logout();
        return;
      }

      await fetchDevices(true);
    } catch (changeError) {
      showMessageModal(changeError?.message || 'No se pudo cambiar el modo del dispositivo.', null, { type: 'error' });
    } finally {
      setModeUpdatingDeviceId(null);
    }
  };

  const handleRelease = async (device) => {
    if (currentDeviceRole === 'staff') {
      showMessageModal('Solo una sesion Admin puede liberar dispositivos.', null, { type: 'error' });
      return;
    }

    if (!navigator.onLine) {
      showMessageModal('Se requiere internet para liberar un dispositivo.', null, { type: 'error' });
      return;
    }

    const isCurrentDevice = Boolean(device.is_current_device);
    const isLastActiveAdmin = device.is_active
      && deviceModeAllowsActor(device, 'admin')
      && devices.filter((entry) => entry.is_active && deviceModeAllowsActor(entry, 'admin')).length === 1;
    const confirmMessage = isLastActiveAdmin
      ? `Este es el ultimo dispositivo con capacidad Admin activa.\n\nPodras recuperar la administracion desde otro dispositivo utilizando las credenciales del propietario.\n\nLa licencia y los datos del negocio no se eliminaran.\n\nDeseas continuar?`
      : isCurrentDevice
        ? 'Vas a liberar este dispositivo. Se cerrara la sesion local y esta licencia podra activarse de nuevo despues. Deseas continuar?'
        : 'Vas a liberar este dispositivo de la licencia. Deseas continuar?';

    if (!(await showConfirmModal(confirmMessage, {
      title: 'Liberar dispositivo',
      confirmButtonText: 'Si, liberar',
      cancelButtonText: 'Cancelar'
    }))) return;

    setIsLoading(true);
    const result = await deactivateDeviceSmart(device.device_id, licenseKey);

    if (result.success) {
      showMessageModal('Dispositivo liberado correctamente.');

      if (isCurrentDevice) {
        await logout();
        return;
      }

      await fetchDevices();
    } else {
      showMessageModal(`Error: ${result.message}`, null, { type: 'error' });
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '20px' }}>
        <div className="spinner-loader small"></div>
        <p className="device-list-loading">Consultando dispositivos...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '15px', backgroundColor: '#fee2e2', borderRadius: '8px', border: '1px solid #fca5a5' }}>
        <p className="device-list-error" style={{ color: '#b91c1c', margin: 0, fontSize: '0.9rem' }}>
          {error}
        </p>
        <button type="button" onClick={() => fetchDevices()} style={{ marginTop: '10px', background: 'white', border: '1px solid #b91c1c', color: '#b91c1c', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer' }}>
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="device-list-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <h4 className="device-manager-tittle" style={{ margin: 0 }}>Dispositivos</h4>

        {isOfflineData ? (
          <span style={{ fontSize: '0.75rem', backgroundColor: '#ffedd5', color: '#c2410c', padding: '2px 8px', borderRadius: '12px', border: '1px solid #fdba74', fontWeight: '600' }}>
            Modo offline
          </span>
        ) : (
          <span style={{ fontSize: '0.75rem', color: 'var(--success-color)', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '600' }}>
            Sincronizado
          </span>
        )}
      </div>

      {devices.length === 0 ? (
        <p style={{ color: '#666', fontStyle: 'italic' }}>No hay dispositivos registrados.</p>
      ) : (
        <ul className="device-list">
          {devices.map((device) => {
            const deviceMode = resolveDeviceMode(device);
            const isUpdatingMode = modeUpdatingDeviceId === device.device_id;
            const modeDisabled = isOfflineData
              || currentDeviceRole === 'staff'
              || !device.is_active
              || isUpdatingMode;

            return (
              <li key={device.device_id} className={`device-item ${device.is_active ? '' : 'inactive'}`}>
                <div className="device-info">
                  <strong>{device.device_name || 'Dispositivo desconocido'}</strong>

                  <div className="device-status-tags">
                    {!device.is_active ? (
                      <span className="device-status-badge inactive">Liberado</span>
                    ) : (
                      <span className="device-status-badge active">Activo</span>
                    )}

                    {device.is_current_device && (
                      <span className="device-status-badge current">Este dispositivo</span>
                    )}

                    <span className="device-status-badge">
                      {getDeviceModeLabel(deviceMode)}
                    </span>

                    {device.device_role && (
                      <span className={`device-status-badge role-${device.device_role}`} title="Rol legacy de compatibilidad; no representa al actor autenticado en modo compartido.">
                        Legacy {device.device_role === 'admin' ? 'Admin' : 'Staff'}
                      </span>
                    )}
                  </div>

                  {(device.staff_display_name || device.staff_username || device.staff_user_id) && (
                    <small>
                      Staff vinculado legacy: {device.staff_display_name || device.staff_username || device.staff_user_id}
                    </small>
                  )}

                  <small>
                    Sesiones activas: Admin {Number(device.active_admin_sessions || 0)} · Staff {Number(device.active_staff_sessions || 0)}
                  </small>

                  <small>
                    Ultimo uso: {new Date(device.last_used_at).toLocaleDateString()}
                  </small>

                  <label style={{ display: 'grid', gap: '4px', marginTop: '8px', maxWidth: '220px' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>Capacidad del dispositivo</span>
                    <select
                      value={deviceMode || ''}
                      onChange={(event) => handleModeChange(device, event.target.value)}
                      disabled={modeDisabled}
                      aria-label={`Modo de ${device.device_name || 'dispositivo'}`}
                    >
                      {!deviceMode && <option value="">Sin definir</option>}
                      {DEVICE_MODE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                </div>

                {device.is_active && (
                  <button
                    type="button"
                    className="btn btn-cancel btn-deactivate-device"
                    onClick={() => handleRelease(device)}
                    disabled={isOfflineData || currentDeviceRole === 'staff' || isUpdatingMode}
                    title={isOfflineData ? 'Conectate para gestionar' : 'Liberar dispositivo'}
                    style={isOfflineData || currentDeviceRole === 'staff' || isUpdatingMode ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
                  >
                    Liberar
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {isOfflineData && lastUpdated && (
        <p style={{ fontSize: '0.7rem', color: '#999', textAlign: 'right', marginTop: '8px' }}>
          Datos guardados: {new Date(lastUpdated).toLocaleString()}
        </p>
      )}
    </div>
  );
}
