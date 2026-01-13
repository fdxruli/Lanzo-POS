import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import DeviceManager from '../common/DeviceManager';

const BUSINESS_RUBROS = [
    { id: 'food_service', label: 'Restaurante / Cocina' },
    { id: 'abarrotes', label: 'Abarrotes' },
    { id: 'farmacia', label: 'Farmacia' },
    { id: 'verduleria/fruteria', label: 'Frutería / Verdulería' },
    { id: 'apparel', label: 'Ropa / Calzado' },
    { id: 'hardware', label: 'Ferretería' },
];

export default function LicenseSettings() {
    const companyProfile = useAppStore((state) => state.companyProfile);
    const updateCompanyProfile = useAppStore((state) => state.updateCompanyProfile);
    const licenseDetails = useAppStore((state) => state.licenseDetails);
    const logout = useAppStore((state) => state.logout);

    const [selectedRubros, setSelectedRubros] = useState([]);

    const licenseFeatures = licenseDetails?.features || {};
    const maxRubrosAllowed = licenseFeatures.max_rubros || 1;
    const allowedRubrosList = licenseFeatures.allowed_rubros || ['*'];
    const isAllAllowed = allowedRubrosList.includes('*');

    useEffect(() => {
        if (companyProfile?.business_type) {
            let types = companyProfile.business_type;
            if (typeof types === 'string') {
                types = types.split(',').map(s => s.trim()).filter(Boolean);
            }
            setSelectedRubros(Array.isArray(types) ? types : []);
        }
    }, [companyProfile]);

    const handleRubroToggle = async (rubroId) => {
        if (!isAllAllowed && !allowedRubrosList.includes(rubroId)) {
            alert("⚠️ Tu licencia no incluye acceso a este módulo. Contacta a soporte para ampliarla.");
            return;
        }

        const isCurrentlySelected = selectedRubros.includes(rubroId);

        // 1. ESCENARIO: DESELECCIONAR
        if (isCurrentlySelected) {
            if (maxRubrosAllowed === 1) {
                alert("🔒 BLOQUEADO: Tu licencia está vinculada permanentemente a este giro de negocio.\n\nNo puedes cambiar el rubro activo sin renovar o actualizar tu licencia.");
                return;
            }
            const newSelection = selectedRubros.filter(id => id !== rubroId);
            setSelectedRubros(newSelection);
            if (companyProfile) await updateCompanyProfile({ ...companyProfile, business_type: newSelection });
            return;
        }

        // 2. ESCENARIO: SELECCIONAR
        if (selectedRubros.length >= maxRubrosAllowed) {
            if (maxRubrosAllowed === 1) {
                alert(`🔒 Tu licencia ya tiene un giro activo. No puedes cambiarlo.`);
            } else {
                alert(`🛑 Límite alcanzado. Tu licencia permite máximo ${maxRubrosAllowed} giros de negocio.`);
            }
            return;
        }

        const newSelection = [...selectedRubros, rubroId];
        setSelectedRubros(newSelection);
        if (companyProfile) await updateCompanyProfile({ ...companyProfile, business_type: newSelection });
    };

    // --- NUEVA FUNCIÓN PARA CONFIRMAR EL LOGOUT ---
    const handleLogout = () => {
        const confirmMessage = "⚠️ ADVERTENCIA DE SEGURIDAD ⚠️\n\n" +
            "¿Estás seguro de que deseas cerrar sesión en este dispositivo?\n\n" +
            "Ten en cuenta lo siguiente:\n" +
            "1. Es posible que NO puedas volver a activar la misma licencia si ya está vinculada a este equipo.\n" +
            "2. Probablemente NO se generará una nueva licencia de prueba porque este dispositivo ya tiene historial de uso.\n\n" +
            "¿Deseas continuar de todos modos?";

        if (window.confirm(confirmMessage)) {
            logout(); // Solo se ejecuta si el usuario da click en "Aceptar"
        }
    };

    const renderLicenseInfo = () => {
        if (!licenseDetails || !licenseDetails.valid) return <p>No hay licencia activa.</p>;
        return (
            <div className="license-info-container">
                <div className="license-info">
                    <div className="license-detail">
                        <span className="license-label">Producto:</span>
                        <span className="license-value">{licenseDetails.product_name || 'N/A'}</span>
                    </div>
                    <div className="license-detail">
                        <span className="license-label">Estado:</span>
                        <span className={licenseDetails.status === 'active' ? 'license-status-active' : 'license-status-expired'}>
                            {licenseDetails.status === 'active' ? 'Activa' : (licenseDetails.status || 'Inactiva')}
                        </span>
                    </div>
                    <div className="license-detail">
                        <span className="license-label">Dispositivos Permitidos:</span>
                        <span className="license-value">
                            {licenseDetails.max_devices ? `${licenseDetails.max_devices} Dispositivo(s)` : '1'}
                        </span>
                    </div>
                    <div className="license-detail">
                        <span className="license-label">Límite de Rubros:</span>
                        <span className="license-value">{maxRubrosAllowed === 999 ? 'Ilimitado' : maxRubrosAllowed}</span>
                    </div>
                </div>
                <h4 className="device-manager-title">Dispositivos Vinculados</h4>
                <DeviceManager licenseKey={licenseDetails.license_key} />
                
                {/* BOTÓN ACTUALIZADO */}
                <button 
                    className="btn btn-cancel" 
                    style={{ width: 'auto', marginTop: '1rem' }} 
                    onClick={handleLogout}
                >
                    Cerrar Sesión en este dispositivo
                </button>
            </div>
        );
    };

    return (
        <div className="company-form-container">
            <h3 className="subtitle">Configuración de Módulos</h3>

            {maxRubrosAllowed === 1 && (
                <p style={{
                    fontSize: '0.9rem',
                    color: '#155724',
                    marginBottom: '15px',
                    backgroundColor: '#d4edda',
                    padding: '10px',
                    borderRadius: '6px',
                    borderLeft: '4px solid #28a745'
                }}>
                    🔒 <strong>Licencia Vinculada:</strong> Tu sistema está configurado exclusivamente para el giro seleccionado abajo.
                </p>
            )}

            <div className="rubro-selector-grid">
                {BUSINESS_RUBROS.map(rubro => {
                    const isSelected = selectedRubros.includes(rubro.id);
                    const isAllowed = isAllAllowed || allowedRubrosList.includes(rubro.id);
                    const isLimitReached = selectedRubros.length >= maxRubrosAllowed;
                    const isHardLocked = maxRubrosAllowed === 1; 

                    let opacity = 1;
                    let cursor = 'pointer';
                    let borderColor = '#e5e7eb';
                    let backgroundColor = 'white';
                    let textColor = 'inherit';
                    let fontWeight = 'normal';

                    if (!isAllowed) {
                        opacity = 0.5;
                        cursor = 'not-allowed';
                    } else if (isSelected) {
                        borderColor = 'var(--primary-color)';
                        backgroundColor = '#f0f9ff'; 
                        fontWeight = '600'; 
                        textColor = '#1e3a8a'; 

                        if (isHardLocked) {
                            cursor = 'default'; 
                        }
                    } else if (isLimitReached || isHardLocked) {
                        opacity = 0.6;
                        cursor = 'not-allowed';
                        backgroundColor = '#f9fafb'; 
                    }

                    return (
                        <div
                            key={rubro.id}
                            className={`rubro-box ${isSelected ? 'selected' : ''}`}
                            onClick={() => handleRubroToggle(rubro.id)}
                            style={{
                                opacity: opacity,
                                cursor: cursor,
                                border: isSelected ? `2px solid ${borderColor}` : `1px solid ${borderColor}`,
                                backgroundColor: backgroundColor,
                                color: textColor,
                                fontWeight: fontWeight,
                                position: 'relative',
                                transition: 'all 0.2s ease', 
                                transform: isSelected ? 'scale(1.02)' : 'none', 
                                boxShadow: isSelected ? '0 2px 5px rgba(0,0,0,0.05)' : 'none'
                            }}
                            title={isSelected && isHardLocked ? "Giro permanente de la licencia" : ""}
                        >
                            {rubro.label}

                            {isSelected && (
                                <span style={{ position: 'absolute', top: 5, right: 8, fontSize: '1rem' }}>
                                    {isHardLocked ? '🔒' : '✅'}
                                </span>
                            )}
                            {(!isSelected && (isLimitReached || !isAllowed || isHardLocked)) && (
                                <span style={{ position: 'absolute', top: 5, right: 8, fontSize: '1rem', filter: 'grayscale(100%)', opacity: 0.5 }}>🔒</span>
                            )}
                        </div>
                    );
                })}
            </div>

            <small className="form-help-text">
                {maxRubrosAllowed === 1
                    ? "El giro de negocio no puede ser modificado con esta licencia."
                    : "Selecciona los giros adicionales para activar sus funciones."}
            </small>

            <h3 className="subtitle" style={{ marginTop: '2rem' }}>Información de Licencia</h3>
            {renderLicenseInfo()}
        </div>
    );
}