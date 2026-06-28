import { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import DeviceManager from '../common/DeviceManager';
import StaffUsersSettings from './StaffUsersSettings';
import { showConfirmModal, showMessageModal } from '../../services/utils';

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
    const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
    const currentStaffUser = useAppStore((state) => state.currentStaffUser);
    const canAccess = useAppStore((state) => state.canAccess);
    const logout = useAppStore((state) => state.logout);
    const logoutStaff = useAppStore((state) => state.logoutStaff);
    const renewLicense = useAppStore((state) => state.renewLicense);

    const [selectedRubros, setSelectedRubros] = useState([]);
    const [isRenewing, setIsRenewing] = useState(false);
    const [renewalError, setRenewalError] = useState('');

    const licenseFeatures = licenseDetails?.features || {};
    const maxRubrosAllowed = licenseFeatures.max_rubros || 1;
    const allowedRubrosList = licenseFeatures.allowed_rubros || ['*'];
    const isAllAllowed = allowedRubrosList.includes('*');
    const isProLicense = licenseFeatures.realtime_license_sync === true;
    const staffRolesEnabled = licenseFeatures.staff_roles === true;
    const isStaffDevice = currentDeviceRole === 'staff';
    const canManageStaff = !isStaffDevice && staffRolesEnabled && canAccess('license');

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
            showMessageModal("⚠️ Tu licencia no incluye acceso a este módulo. Contacta a soporte para ampliarla.", null, { type: 'warning' });
            return;
        }

        const isCurrentlySelected = selectedRubros.includes(rubroId);

        // 1. ESCENARIO: DESELECCIONAR
        if (isCurrentlySelected) {
            if (maxRubrosAllowed === 1) {
                showMessageModal("🔒 BLOQUEADO: Tu licencia está vinculada permanentemente a este giro de negocio.\n\nNo puedes cambiar el rubro activo sin renovar o actualizar tu licencia.", null, { type: 'warning' });
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
                showMessageModal(`🔒 Tu licencia ya tiene un giro activo. No puedes cambiarlo.`, null, { type: 'warning' });
            } else {
                showMessageModal(`🛑 Límite alcanzado. Tu licencia permite máximo ${maxRubrosAllowed} giros de negocio.`, null, { type: 'warning' });
            }
            return;
        }

        const newSelection = [...selectedRubros, rubroId];
        setSelectedRubros(newSelection);
        if (companyProfile) await updateCompanyProfile({ ...companyProfile, business_type: newSelection });
    };

    const handleLogout = async () => {
        const confirmMessage =
            "Cerrar sesion solo saldra de la app en este equipo.\n\n" +
            "La licencia seguira vinculada a este dispositivo. Si quieres liberar el cupo remoto, usa el boton Liberar en la lista de dispositivos.\n\n" +
            "Deseas cerrar sesion localmente?";

        if (await showConfirmModal(confirmMessage, {
            title: 'Cerrar sesion local',
            confirmButtonText: 'Si, cerrar sesion'
        })) {
            logout();
        }
    };

    const handleStaffLogout = async () => {
        if (await showConfirmModal('Deseas cerrar solo la sesion staff en este dispositivo?', {
            title: 'Cerrar sesion staff',
            confirmButtonText: 'Si, cerrar sesion'
        })) {
            logoutStaff();
        }
    };

    const getExpirationInfo = () => {
        // NOTA: Asegúrate de que tu DB devuelva 'expires_at' o cambia esta propiedad
        const expiryDateString = licenseDetails?.expires_at; 
        
        if (!expiryDateString) return null;

        const now = new Date();
        const expiryDate = new Date(expiryDateString);
        
        // Calculamos el fin del periodo de gracia (7 días después del vencimiento)
        const gracePeriodDays = 7;
        const graceEndDate = new Date(expiryDate);
        graceEndDate.setDate(graceEndDate.getDate() + gracePeriodDays);

        const isExpired = now > expiryDate;
        const inGracePeriod = isExpired && now < graceEndDate;
        const daysLeftInGrace = inGracePeriod 
            ? Math.ceil((graceEndDate - now) / (1000 * 60 * 60 * 24)) 
            : 0;

        // Formato de fecha legible
        const formattedDate = expiryDate.toLocaleDateString('es-MX', { 
            year: 'numeric', month: 'long', day: 'numeric' 
        });

        if (inGracePeriod) {
            return (
                <div className="license-expiration-state license-expiration-state--grace">
                    Vencida (Periodo de Gracia)<br/>
                    <span className="license-expiration-note">
                        Corte definitivo en: {daysLeftInGrace} días
                    </span>
                </div>
            );
        }

        if (isExpired && !inGracePeriod) {
             return (
                <div className="license-expiration-state license-expiration-state--expired">
                    Licencia Suspendida<br/>
                    <span className="license-expiration-note">
                        Expiró el: {formattedDate}
                    </span>
                </div>
            );
        }

        // Si está activa normal
        return <span className="license-value">{formattedDate}</span>;
    };

    const getMaskedLicense = () => {
        const key = licenseDetails?.license_key;
        if (!key) return 'Desconocida';
        if (key.length <= 6) return key;
        return `****-****-${key.slice(-6).toUpperCase()}`;
    };

    const getGracePeriodState = () => {
        const expiryDateString = licenseDetails?.expires_at;
        if (!expiryDateString) return { inGracePeriod: false };

        const now = new Date();
        const expiryDate = new Date(expiryDateString);
        if (Number.isNaN(expiryDate.getTime())) return { inGracePeriod: false };

        const graceEndDate = new Date(expiryDate);
        graceEndDate.setDate(graceEndDate.getDate() + 7);

        return {
            inGracePeriod: now > expiryDate && now < graceEndDate
        };
    };

    const gracePeriodState = getGracePeriodState();

    const handleRenewLicense = async () => {
        setIsRenewing(true);
        setRenewalError('');

        try {
            const result = await renewLicense();

            if (!result?.success) {
                setRenewalError(result?.message || 'No se pudo renovar la licencia.');
            }
        } catch (error) {
            setRenewalError(error?.message || 'Ocurrio un error al renovar la licencia.');
        } finally {
            setIsRenewing(false);
        }
    };

    const renderLicenseInfo = () => {
        if (!licenseDetails || !licenseDetails.valid) return <p>No hay licencia activa.</p>;
        
        return (
            <div className="license-info-container">
                <div className="license-info">
                    <div className="license-detail">
                        <span className="license-label">ID Licencia:</span>
                        <span className="license-id-value">
                            <span className="license-value license-key-value">
                                {getMaskedLicense()}
                            </span>
                            {isProLicense && (
                                <span className="license-plan-badge license-plan-badge--pro">
                                    PRO
                                </span>
                            )}
                        </span>
                    </div>
                    
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
                        <span className="license-label">Tipo de dispositivo:</span>
                        <span className="license-id-value">
                            <span className="license-value">
                                {isStaffDevice ? 'Staff' : 'Administrador'}
                            </span>
                            {!isStaffDevice && (
                                <span className="license-plan-badge license-plan-badge--admin">
                                    Admin
                                </span>
                            )}
                        </span>
                    </div>

                    {isStaffDevice && currentStaffUser && (
                        <>
                            <div className="license-detail">
                                <span className="license-label">Staff:</span>
                                <span className="license-value">{currentStaffUser.display_name || currentStaffUser.username}</span>
                            </div>
                            <div className="license-detail">
                                <span className="license-label">Usuario:</span>
                                <span className="license-value">@{currentStaffUser.username}</span>
                            </div>
                            <div className="license-detail">
                                <span className="license-label">Rol:</span>
                                <span className="license-value">{currentStaffUser.role_name || 'staff'}</span>
                            </div>
                        </>
                    )}
                    
                    {/* --- NUEVO CAMPO DE VENCIMIENTO --- */}
                    <div className="license-detail">
                        <span className="license-label">Vencimiento:</span>
                        {getExpirationInfo() || <span className="license-value">Permanente</span>}
                    </div>
                    {/* ---------------------------------- */}

                    {gracePeriodState.inGracePeriod && (
                        <div className="license-renewal-panel">
                            <div className="license-renewal-copy">
                                <strong>Renovacion disponible</strong>
                                <span>Extiende esta licencia por 3 meses mas.</span>
                            </div>
                            <button
                                type="button"
                                className="btn btn-primary license-renewal-button"
                                onClick={handleRenewLicense}
                                disabled={isRenewing}
                            >
                                <RefreshCw size={18} />
                                <span>{isRenewing ? 'Renovando...' : 'Renovar 3 meses'}</span>
                            </button>
                        </div>
                    )}

                    {renewalError && (
                        <div className="license-renewal-error">
                            {renewalError}
                        </div>
                    )}

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
                {staffRolesEnabled ? (
                    <div className="license-staff-feature-note">
                        Roles staff disponibles en esta licencia.
                    </div>
                ) : (
                    <div className="license-staff-feature-warning">
                        Este plan no incluye usuarios staff.
                    </div>
                )}

                {!isStaffDevice && canAccess('devices') && (
                    <>
                        <h4 className="device-manager-title">Dispositivos Vinculados</h4>
                        <DeviceManager licenseKey={licenseDetails.license_key} />
                    </>
                )}

                {canManageStaff && (
                    <StaffUsersSettings licenseKey={licenseDetails.license_key} />
                )}
                
                <button 
                    className="btn btn-cancel license-logout-button" 
                    onClick={isStaffDevice ? handleStaffLogout : handleLogout}
                >
                    {isStaffDevice ? 'Cerrar sesion staff' : 'Cerrar sesion local'}
                </button>
            </div>
        );
    };

    return (
        <div className="company-form-container">
            <h3 className="subtitle">Configuración de Módulos</h3>

            {maxRubrosAllowed === 1 && (
                <p className="ui-alert ui-alert--success license-linked-alert">
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
                                <span className="rubro-state-icon">
                                    {isHardLocked ? '🔒' : '✅'}
                                </span>
                            )}
                            {(!isSelected && (isLimitReached || !isAllowed || isHardLocked)) && (
                                <span className="rubro-state-icon rubro-state-icon--muted">🔒</span>
                            )}
                        </div>
                    );
                })}
            </div>

            <small className="form-help-text">
                {maxRubrosAllowed === 1
                    ? "El giro de negocio no puede ser modificado con esta licencia. Contacta a soporte si necesitas cambiar de rubro"
                    : "Selecciona los giros adicionales para activar sus funciones."}
            </small>

            <h3 className="subtitle license-section-title">Información de Licencia</h3>
            {renderLicenseInfo()}
        </div>
    );
}
