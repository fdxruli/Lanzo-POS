// src/components/common/DeviceManager.jsx
import React, { useState, useEffect, useCallback } from 'react';
import './DeviceManager.css';
// IMPORTAMOS EL NUEVO SERVICIO
import { getLicenseDevicesSmart, deactivateDeviceSmart } from '../../services/licenseService';
import { showMessageModal } from '../../services/utils';

export default function DeviceManager({ licenseKey }) {
  const [devices, setDevices] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Estados para UX Offline
  const [isOfflineData, setIsOfflineData] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Función de carga inteligente
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

  // Listener para auto-recargar cuando vuelve el internet
  useEffect(() => {
    const handleOnline = () => {
        // Feedback visual tipo Toast
        showMessageModal("Conexión restaurada. Sincronizando...", null, { type: 'success' });
        fetchDevices(true); // true = carga silenciosa sin spinner grande
    };
    
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [fetchDevices]);

  // Carga inicial
  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  const handleDeactivate = async (deviceId) => {
    if (!navigator.onLine) {
        showMessageModal("⚠️ Se requiere internet para desactivar un dispositivo.", null, { type: 'error' });
        return;
    }

    if (!window.confirm('¿Seguro que quieres eliminar el acceso a este dispositivo?')) return;
    
    // Bloqueo temporal optimista
    setIsLoading(true);

    const result = await deactivateDeviceSmart(deviceId, licenseKey);
    
    if (result.success) {
        showMessageModal('✅ Dispositivo desactivado correctamente.');
        await fetchDevices(); // Refrescar lista
    } else {
        showMessageModal(`Error: ${result.message}`, null, { type: 'error' });
        setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
        <div style={{textAlign:'center', padding:'20px'}}>
            <div className="spinner-loader small"></div>
            <p className="device-list-loading">Consultando dispositivos...</p>
        </div>
    );
  }

  if (error) {
    return (
        <div style={{padding:'15px', backgroundColor:'#fee2e2', borderRadius:'8px', border:'1px solid #fca5a5'}}>
            <p className="device-list-error" style={{color:'#b91c1c', margin:0, fontSize:'0.9rem'}}>
                {error}
            </p>
            <button onClick={() => fetchDevices()} style={{marginTop:'10px', background:'white', border:'1px solid #b91c1c', color:'#b91c1c', padding:'5px 10px', borderRadius:'4px', cursor:'pointer'}}>
                Reintentar
            </button>
        </div>
    );
  }

  return (
    <div className="device-list-container">
      {/* HEADER CON ESTADO DE CONEXIÓN */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'10px' }}>
          <h4 className="device-manager-tittle" style={{margin:0}}>Dispositivos</h4>
          
          {isOfflineData ? (
              <span style={{fontSize:'0.75rem', backgroundColor:'#ffedd5', color:'#c2410c', padding:'2px 8px', borderRadius:'12px', border:'1px solid #fdba74', fontWeight:'600'}}>
                  ☁️ Modo Offline
              </span>
          ) : (
              <span style={{fontSize:'0.75rem', color:'var(--success-color)', display:'flex', alignItems:'center', gap:'4px', fontWeight:'600'}}>
                  ● Sincronizado
              </span>
          )}
      </div>

      {/* LISTA */}
      {devices.length === 0 ? (
        <p style={{color:'#666', fontStyle:'italic'}}>No hay dispositivos registrados.</p>
      ) : (
        <ul className="device-list">
            {devices.map(device => (
            <li key={device.device_id} className={`device-item ${device.is_active ? '' : 'inactive'}`}>
                <div className="device-info">
                    <strong>{device.device_name || 'Dispositivo Desconocido'}</strong>
                    
                    <div className="device-status-tags">
                        {!device.is_active ? (
                        <span className="device-status-badge inactive">Desactivado</span>
                        ) : (
                        <span className="device-status-badge active">Activo</span>
                        )}
                        
                        {device.is_current_device && (
                        <span className="device-status-badge current">Este Dispositivo</span>
                        )}
                    </div>

                    <small>
                        Último uso: {new Date(device.last_used_at).toLocaleDateString()}
                    </small>
                </div>
                
                {device.is_active && (
                <button
                    className="btn btn-cancel btn-deactivate-device"
                    onClick={() => handleDeactivate(device.device_id)}
                    disabled={device.is_current_device || isOfflineData} 
                    title={isOfflineData ? "Conéctate para gestionar" : "Desactivar acceso"}
                    style={isOfflineData ? {opacity:0.5, cursor:'not-allowed'} : {}}
                >
                    Desactivar
                </button>
                )}
            </li>
            ))}
        </ul>
      )}
      
      {/* Footer informativo */}
      {isOfflineData && lastUpdated && (
          <p style={{fontSize:'0.7rem', color:'#999', textAlign:'right', marginTop:'8px'}}>
              Datos guardados: {new Date(lastUpdated).toLocaleString()}
          </p>
      )}
    </div>
  );
}