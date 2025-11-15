// src/components/common/DeviceManager.jsx
import React, { useState, useEffect, useCallback } from 'react';
import './DeviceManager.css';

export default function DeviceManager({ licenseKey }) {
  const [devices, setDevices] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Función para cargar los dispositivos
  const fetchDevices = useCallback(async () => {
    if (!licenseKey) return;
    
    setIsLoading(true);
    setError(null);
    try {
      const result = await window.getLicenseDevices(licenseKey);
      if (result.success) {
        setDevices(result.data);
      } else {
        setError(result.message || 'Error al cargar dispositivos.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [licenseKey]);

  // Cargar dispositivos al montar el componente
  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  // Manejador para el botón de desactivar
  const handleDeactivate = async (deviceId) => {
    if (!window.confirm('¿Seguro que quieres desactivar este dispositivo? Perderá el acceso.')) {
      return;
    }
    
    try {
      const result = await window.deactivateDeviceById(deviceId);
      if (result.success) {
        alert('Dispositivo desactivado con éxito.');
        fetchDevices(); // Recargar la lista
      } else {
        alert(`Error: ${result.message}`);
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  };

  if (isLoading) {
    return <p className="device-list-loading">Cargando dispositivos...</p>;
  }

  if (error) {
    return <p className="device-list-error">Error: {error}</p>;
  }

  if (devices.length === 0) {
    return <p>No hay dispositivos activados para esta licencia.</p>;
  }

  // Obtenemos la huella del dispositivo actual para marcarlo
  const currentFingerprint = localStorage.getItem('fp'); // Asumimos que guardas esto

  return (
    <div className="device-list-container">
      <ul className="device-list">
        {devices.map(device => (
          <li key={device.device_id} className={`device-item ${device.is_active ? '' : 'inactive'}`}>
            <div className="device-info">
              <strong>{device.device_name || 'Dispositivo Desconocido'}</strong>
              
              {!device.is_active ? (
                <span className="device-status-badge inactive">Desactivado</span>
              ) : (
                 <span className="device-status-badge active">Activo</span>
              )}
              
              <small>
                Último uso: {new Date(device.last_used_at).toLocaleString()}
              </small>
            </div>
            {device.is_active && (
              <button
                className="btn btn-cancel btn-deactivate-device"
                onClick={() => handleDeactivate(device.device_id)}
              >
                Desactivar
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}