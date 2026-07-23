import { useMemo, useState } from 'react';
import {
    BadgeCheck,
    BriefcaseBusiness,
    Check,
    CircleSlash,
    Clock3,
    Copy,
    KeyRound,
    Layers3,
    LockKeyhole,
    LogOut,
    RefreshCw,
    ShieldCheck,
    Smartphone,
    Store,
    Users
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import DeviceManager from '../common/DeviceManager';
import StaffUsersSettings from './StaffUsersSettings';
import { showConfirmModal, showMessageModal } from '../../services/utils';
import { getCommercialPlanName, getCommercialPlanShortName } from '../../utils/planDisplay';

const BUSINESS_RUBROS = [
    { id: 'food_service', label: 'Restaurante / Cocina', description: 'Recetas, comandas e insumos.', Icon: Store },
    { id: 'abarrotes', label: 'Abarrotes', description: 'Venta rapida e inventario base.', Icon: BriefcaseBusiness },
    { id: 'farmacia', label: 'Farmacia', description: 'Control especializado por categoria.', Icon: ShieldCheck },
    { id: 'verduleria/fruteria', label: 'Fruteria / Verduleria', description: 'Venta por peso y productos frescos.', Icon: Layers3 },
    { id: 'apparel', label: 'Ropa / Calzado', description: 'Variantes y articulos por talla.', Icon: BadgeCheck },
    { id: 'hardware', label: 'Ferreteria', description: 'Catalogos tecnicos y piezas.', Icon: KeyRound }
];

const getPlanCode = (licenseDetails = {}) => String(
    licenseDetails?.plan_code ||
    licenseDetails?.plan ||
    licenseDetails?.subscription_plan ||
    licenseDetails?.product_code ||
    ''
).trim().toLowerCase();

const getFreeState = (licenseDetails = {}) => {
    const planCode = getPlanCode(licenseDetails);
    const licenseType = String(licenseDetails?.license_type || '').trim().toLowerCase();
    const isPaidPlan = planCode.includes('pro') || planCode.includes('basic');
    const isFreePlan = !isPaidPlan && (
        planCode === 'free_trial' ||
        planCode.includes('free') ||
        planCode.includes('trial') ||
        licenseType === 'free'
    );

    return {
        isFreePlan,
        isFreeLifetime: isFreePlan && (
            licenseDetails?.is_lifetime === true ||
            licenseDetails?.expires_at === null ||
            licenseDetails?.expires_at === undefined ||
            licenseType === 'free'
        )
    };
};

const normalizeRubros = (businessType) => {
    if (!businessType) return [];
    if (typeof businessType === 'string') {
        return businessType.split(',').reduce((rubros, type) => {
            const trimmedType = type.trim();
            if (trimmedType) rubros.push(trimmedType);
            return rubros;
        }, []);
    }
    return Array.isArray(businessType) ? businessType : [];
};

function getFullLicense(licenseDetails) {
    return licenseDetails?.license_key || 'Desconocida';
}

function getGracePeriodState(licenseDetails) {
    const expiryDateString = licenseDetails?.expires_at;
    if (!expiryDateString) return { inGracePeriod: false };

    const now = new Date();
    const expiryDate = new Date(expiryDateString);
    if (Number.isNaN(expiryDate.getTime())) return { inGracePeriod: false };

    const graceEndDate = new Date(expiryDate);
    graceEndDate.setDate(graceEndDate.getDate() + 7);
    return { inGracePeriod: now > expiryDate && now < graceEndDate };
}

function getExpirationInfo(licenseDetails) {
    const expiryDateString = licenseDetails?.expires_at;
    if (!expiryDateString) return { label: 'Permanente', tone: 'success', note: '' };

    const now = new Date();
    const expiryDate = new Date(expiryDateString);
    const graceEndDate = new Date(expiryDate);
    graceEndDate.setDate(graceEndDate.getDate() + 7);

    const isExpired = now > expiryDate;
    const inGracePeriod = isExpired && now < graceEndDate;
    const daysLeftInGrace = inGracePeriod ? Math.ceil((graceEndDate - now) / (1000 * 60 * 60 * 24)) : 0;
    const formattedDate = expiryDate.toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });

    if (inGracePeriod) {
        return {
            label: 'Vencida en gracia',
            tone: 'warning',
            note: `Corte definitivo en ${daysLeftInGrace} dias`
        };
    }

    if (isExpired) {
        return {
            label: 'Licencia suspendida',
            tone: 'danger',
            note: `Expiro el ${formattedDate}`
        };
    }

    return { label: formattedDate, tone: 'neutral', note: '' };
}

function LicenseHero({ selectedCount, maxRubrosAllowed, planName, licenseStatus }) {
    return (
        <header className="license-settings-hero">
            <div className="license-hero-copy">
                <span className="license-kicker">
                    <ShieldCheck size={15} />
                    Licencia y rubros
                </span>
                <div>
                    <h2>Permisos del sistema</h2>
                    <p>Consulta tu licencia, controla los giros activos y administra accesos vinculados.</p>
                </div>
            </div>

            <div className="license-hero-metrics" aria-label="Resumen de licencia">
                <div>
                    <span>Estado</span>
                    <strong>{licenseStatus === 'active' ? 'Activa' : licenseStatus || 'Inactiva'}</strong>
                </div>
                <div>
                    <span>Plan</span>
                    <strong>{planName}</strong>
                </div>
                <div>
                    <span>Rubros</span>
                    <strong>{selectedCount}/{maxRubrosAllowed === 999 ? '∞' : maxRubrosAllowed}</strong>
                </div>
            </div>
        </header>
    );
}

function RubroCard({ rubro, stateKind, onToggle }) {
    const Icon = rubro.Icon;
    const selected = stateKind === 'selected' || stateKind === 'linked';
    const disabled = stateKind === 'blocked' || stateKind === 'limit';
    const stateLabel = selected ? (stateKind === 'linked' ? 'Vinculado' : 'Activo') : disabled ? 'Bloqueado' : 'Disponible';

    return (
        <button
            type="button"
            className={`rubro-premium-card ${selected ? 'is-selected' : ''} ${disabled ? 'is-disabled' : ''}`}
            onClick={() => onToggle(rubro.id)}
            disabled={disabled && !selected}
            title={stateKind === 'linked' ? 'Giro permanente de la licencia' : undefined}
        >
            <span className="rubro-premium-icon" aria-hidden="true">
                <Icon size={18} />
            </span>
            <span className="rubro-premium-copy">
                <strong>{rubro.label}</strong>
                <small>{rubro.description}</small>
            </span>
            <span className={`rubro-premium-state ${selected ? 'is-selected' : ''}`}>
                {selected ? <Check size={15} /> : disabled ? <LockKeyhole size={15} /> : <CircleSlash size={15} />}
                {stateLabel}
            </span>
        </button>
    );
}

function RubroSelector({ selectedRubros, selectedRubrosSet, maxRubrosAllowed, allowedRubrosList, isAllAllowed, onToggle }) {
    const isHardLocked = maxRubrosAllowed === 1;
    const isLimitReached = selectedRubros.length >= maxRubrosAllowed;
    const getRubroState = (rubro) => {
        const selected = selectedRubrosSet.has(rubro.id);
        const allowed = isAllAllowed || allowedRubrosList.includes(rubro.id);
        if (selected) return isHardLocked ? 'linked' : 'selected';
        if (!allowed) return 'blocked';
        if (isHardLocked || isLimitReached) return 'limit';
        return 'available';
    };

    return (
        <section className="license-panel license-rubros-panel">
            <div className="license-panel-heading">
                <div>
                    <h3>Configuracion de modulos</h3>
                    <p>Selecciona los giros que activan herramientas especificas dentro del POS.</p>
                </div>
                <span className="license-panel-badge">
                    {maxRubrosAllowed === 999 ? 'Ilimitado' : `${selectedRubros.length}/${maxRubrosAllowed}`}
                </span>
            </div>

            {isHardLocked && (
                <div className="license-linked-alert" role="note">
                    <LockKeyhole size={17} />
                    <span><strong>Licencia vinculada:</strong> el sistema queda asociado al giro seleccionado.</span>
                </div>
            )}

            <div className="rubro-premium-grid">
                {BUSINESS_RUBROS.map((rubro) => (
                    <RubroCard
                        key={rubro.id}
                        rubro={rubro}
                        stateKind={getRubroState(rubro)}
                        onToggle={onToggle}
                    />
                ))}
            </div>

            <small className="form-help-text license-rubro-help">
                {isHardLocked
                    ? 'El giro no puede modificarse con esta licencia. Contacta a soporte si necesitas cambiarlo.'
                    : 'Puedes activar rubros adicionales hasta el limite incluido en tu licencia.'}
            </small>
        </section>
    );
}

function LicenseDetail({ label, value, children }) {
    return (
        <div className="license-detail-row">
            <dt>{label}</dt>
            <dd>{children || value}</dd>
        </div>
    );
}

function LicenseInfoPanel({
    licenseDetails,
    licenseContext,
    onFreeCompatibilityUpdate,
    onLogout
}) {
    const {
        maxRubrosAllowed,
        isProLicense,
        isStaffDevice,
        currentStaffUser,
        staffRolesEnabled,
        showFreeCompatibilityUpdate,
        isUpdatingFree,
        freeUpdateError
    } = licenseContext;
    const expirationInfo = getExpirationInfo(licenseDetails);
    const [copiedLicense, setCopiedLicense] = useState(false);
    const commercialPlanName = getCommercialPlanName(licenseDetails);
    const commercialPlanShortName = getCommercialPlanShortName(licenseDetails);

    const handleCopyLicense = async () => {
        const licenseKey = licenseDetails?.license_key;
        if (!licenseKey) return;

        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(licenseKey);
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = licenseKey;
                textarea.setAttribute('readonly', '');
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
            }

            setCopiedLicense(true);
            window.setTimeout(() => setCopiedLicense(false), 1800);
        } catch {
            showMessageModal('No se pudo copiar la licencia. Intenta seleccionarla manualmente.', null, { type: 'error' });
        }
    };

    if (!licenseDetails || !licenseDetails.valid) {
        return (
            <section className="license-panel license-info-empty">
                <KeyRound size={34} />
                <strong>No hay licencia activa</strong>
                <span>Activa una licencia para consultar permisos, rubros y dispositivos.</span>
            </section>
        );
    }

    return (
        <section className="license-panel license-info-panel">
            <div className="license-panel-heading">
                <div>
                    <h3>Informacion de licencia</h3>
                    <p>Datos de activacion, vigencia y capacidades disponibles.</p>
                </div>
                <span className={`license-status-pill ${licenseDetails.status === 'active' ? 'is-active' : 'is-expired'}`}>
                    {licenseDetails.status === 'active' ? 'Activa' : licenseDetails.status || 'Inactiva'}
                </span>
            </div>

            <dl className="license-detail-grid">
                <LicenseDetail label="ID de licencia">
                    <span className="license-id-value license-id-value--copyable">
                        <span className="license-value license-key-value license-key-text">{getFullLicense(licenseDetails)}</span>
                        <button
                            type="button"
                            className={`license-copy-button ${copiedLicense ? 'is-copied' : ''}`}
                            onClick={handleCopyLicense}
                            disabled={!licenseDetails?.license_key}
                            aria-label="Copiar ID de licencia"
                            title="Copiar ID de licencia"
                        >
                            {copiedLicense ? <Check size={15} /> : <Copy size={15} />}
                            <span>{copiedLicense ? 'Copiado' : 'Copiar'}</span>
                        </button>
                        <span className={`license-plan-badge ${isProLicense ? 'license-plan-badge--pro' : ''}`}>
                            {commercialPlanShortName}
                        </span>
                    </span>
                </LicenseDetail>
                <LicenseDetail label="Producto" value="Lanzo POS" />
                <LicenseDetail label="Plan" value={commercialPlanName} />
                <LicenseDetail label="Dispositivo">
                    <span className="license-id-value">
                        <span>{isStaffDevice ? 'Staff' : 'Administrador'}</span>
                        {!isStaffDevice && <span className="license-plan-badge license-plan-badge--admin">Admin</span>}
                    </span>
                </LicenseDetail>
                <LicenseDetail label="Vencimiento">
                    <span className={`license-expiration-chip is-${expirationInfo.tone}`}>
                        <Clock3 size={15} />
                        <span>
                            <strong>{expirationInfo.label}</strong>
                            {expirationInfo.note && <small>{expirationInfo.note}</small>}
                        </span>
                    </span>
                </LicenseDetail>
                <LicenseDetail label="Dispositivos" value={licenseDetails.max_devices ? `${licenseDetails.max_devices} dispositivo(s)` : '1'} />
                <LicenseDetail label="Limite de rubros" value={maxRubrosAllowed === 999 ? 'Ilimitado' : maxRubrosAllowed} />

                {isStaffDevice && currentStaffUser && (
                    <>
                        <LicenseDetail label="Staff" value={currentStaffUser.display_name || currentStaffUser.username} />
                        <LicenseDetail label="Usuario" value={`@${currentStaffUser.username}`} />
                        <LicenseDetail label="Rol" value={currentStaffUser.role_name || 'staff'} />
                    </>
                )}
            </dl>

            {showFreeCompatibilityUpdate && (
                <div className="license-renewal-panel">
                    <div className="license-renewal-copy">
                        <strong>Actualizacion Lanzo Local disponible</strong>
                        <span>Esta licencia se actualizara a Lanzo Local permanente.</span>
                    </div>
                    <button type="button" className="btn btn-primary license-renewal-button" onClick={onFreeCompatibilityUpdate} disabled={isUpdatingFree}>
                        <RefreshCw size={18} />
                        <span>{isUpdatingFree ? 'Actualizando...' : 'Actualizar a Lanzo Local permanente'}</span>
                    </button>
                </div>
            )}

            {freeUpdateError && <div className="license-renewal-error">{freeUpdateError}</div>}

            <div className={`license-staff-access ${staffRolesEnabled ? 'is-enabled' : 'is-disabled'}`}>
                <Users size={18} />
                <span>{staffRolesEnabled ? 'Roles staff disponibles en esta licencia.' : 'Este plan no incluye usuarios staff.'}</span>
            </div>

            <button type="button" className="btn btn-cancel license-logout-button" onClick={onLogout}>
                <LogOut size={16} />
                {isStaffDevice ? 'Cerrar sesion staff' : 'Cerrar sesion admin'}
            </button>
        </section>
    );
}

export default function LicenseSettings() {
    const companyProfile = useAppStore((state) => state.companyProfile);
    const updateCompanyProfile = useAppStore((state) => state.updateCompanyProfile);
    const licenseDetails = useAppStore((state) => state.licenseDetails);
    const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
    const currentStaffUser = useAppStore((state) => state.currentStaffUser);
    const canAccess = useAppStore((state) => state.canAccess);
    const logoutStaff = useAppStore((state) => state.logoutStaff);
    const logoutAdmin = useAppStore((state) => state.logoutAdmin);
    const renewLicense = useAppStore((state) => state.renewLicense);

    const [isUpdatingFree, setIsUpdatingFree] = useState(false);
    const [freeUpdateError, setFreeUpdateError] = useState('');

    const licenseFeatures = licenseDetails?.features || {};
    const maxRubrosAllowed = licenseFeatures.max_rubros || 1;
    const allowedRubrosList = licenseFeatures.allowed_rubros || ['*'];
    const isAllAllowed = allowedRubrosList.includes('*');
    const isProLicense = licenseFeatures.realtime_license_sync === true;
    const staffRolesEnabled = licenseFeatures.staff_roles === true;
    const isStaffDevice = currentDeviceRole === 'staff';
    const canManageStaff = !isStaffDevice && staffRolesEnabled && canAccess('license');
    const gracePeriodState = getGracePeriodState(licenseDetails);
    const { isFreePlan, isFreeLifetime } = getFreeState(licenseDetails);
    const showFreeCompatibilityUpdate = gracePeriodState.inGracePeriod && isFreePlan && !isFreeLifetime;
    const commercialPlanName = getCommercialPlanName(licenseDetails);

    const selectedRubros = useMemo(() => normalizeRubros(companyProfile?.business_type), [companyProfile]);
    const selectedRubrosSet = useMemo(() => new Set(selectedRubros), [selectedRubros]);
    const activeRubroLabels = useMemo(() => {
        const labels = [];
        for (const rubro of BUSINESS_RUBROS) {
            if (selectedRubrosSet.has(rubro.id)) labels.push(rubro.label);
        }
        return labels.join(', ') || 'Sin rubro activo';
    }, [selectedRubrosSet]);
    const licenseContext = useMemo(() => ({
        maxRubrosAllowed,
        isProLicense,
        isStaffDevice,
        currentStaffUser,
        staffRolesEnabled,
        showFreeCompatibilityUpdate,
        isUpdatingFree,
        freeUpdateError
    }), [
        maxRubrosAllowed,
        isProLicense,
        isStaffDevice,
        currentStaffUser,
        staffRolesEnabled,
        showFreeCompatibilityUpdate,
        isUpdatingFree,
        freeUpdateError
    ]);

    const handleRubroToggle = async (rubroId) => {
        if (!isAllAllowed && !allowedRubrosList.includes(rubroId)) {
            showMessageModal('Tu licencia no incluye acceso a este modulo. Contacta a soporte para ampliarla.', null, { type: 'warning' });
            return;
        }

        const isCurrentlySelected = selectedRubros.includes(rubroId);
        if (isCurrentlySelected) {
            if (maxRubrosAllowed === 1) {
                showMessageModal('Tu licencia esta vinculada permanentemente a este giro de negocio. Contacta a soporte para cambiarlo.', null, { type: 'warning' });
                return;
            }

            const newSelection = selectedRubros.filter((id) => id !== rubroId);
            if (companyProfile) await updateCompanyProfile({ ...companyProfile, business_type: newSelection });
            return;
        }

        if (selectedRubros.length >= maxRubrosAllowed) {
            showMessageModal(
                maxRubrosAllowed === 1
                    ? 'Tu licencia ya tiene un giro activo. No puedes cambiarlo.'
                    : `Limite alcanzado. Tu licencia permite maximo ${maxRubrosAllowed} giros de negocio.`,
                null,
                { type: 'warning' }
            );
            return;
        }

        const newSelection = [...selectedRubros, rubroId];
        if (companyProfile) await updateCompanyProfile({ ...companyProfile, business_type: newSelection });
    };

    const handleLogout = async () => {
        const confirmMessage =
            'Cerrar sesion revocara la sesion administrativa de este equipo.\n\n' +
            'La licencia seguira vinculada a este dispositivo. Si quieres liberar el cupo remoto, usa el boton Liberar en la lista de dispositivos.\n\n' +
            'Deseas cerrar la sesion administrativa?';

        if (await showConfirmModal(confirmMessage, { title: 'Cerrar sesion admin', confirmButtonText: 'Si, cerrar sesion' })) logoutAdmin();
    };

    const handleStaffLogout = async () => {
        if (await showConfirmModal('Deseas cerrar solo la sesion staff en este dispositivo?', { title: 'Cerrar sesion staff', confirmButtonText: 'Si, cerrar sesion' })) logoutStaff();
    };

    const handleFreeCompatibilityUpdate = async () => {
        setIsUpdatingFree(true);
        setFreeUpdateError('');
        try {
            const result = await renewLicense();
            if (!result?.success) setFreeUpdateError(result?.message || 'No se pudo actualizar la licencia.');
        } catch (error) {
            setFreeUpdateError(error?.message || 'Ocurrio un error al actualizar la licencia.');
        } finally {
            setIsUpdatingFree(false);
        }
    };

    return (
        <div className="license-settings-shell">
            <LicenseHero
                selectedCount={selectedRubros.length}
                maxRubrosAllowed={maxRubrosAllowed}
                planName={commercialPlanName}
                licenseStatus={licenseDetails?.status}
            />

            <div className="license-settings-layout">
                <RubroSelector
                    selectedRubros={selectedRubros}
                    selectedRubrosSet={selectedRubrosSet}
                    maxRubrosAllowed={maxRubrosAllowed}
                    allowedRubrosList={allowedRubrosList}
                    isAllAllowed={isAllAllowed}
                    onToggle={handleRubroToggle}
                />

                <LicenseInfoPanel
                    licenseDetails={licenseDetails}
                    licenseContext={licenseContext}
                    onFreeCompatibilityUpdate={handleFreeCompatibilityUpdate}
                    onLogout={isStaffDevice ? handleStaffLogout : handleLogout}
                />
            </div>

            <section className="license-panel license-active-rubros" aria-label="Rubros activos">
                <span>Rubros activos</span>
                <strong>{activeRubroLabels}</strong>
            </section>

            {!isStaffDevice && canAccess('devices') && licenseDetails?.valid && (
                <section className="license-panel license-linked-devices">
                    <div className="license-panel-heading">
                        <div>
                            <h3>Dispositivos vinculados</h3>
                            <p>Revisa equipos conectados y libera cupos cuando sea necesario.</p>
                        </div>
                        <span className="license-panel-badge">
                            <Smartphone size={15} />
                            Equipos
                        </span>
                    </div>
                    <DeviceManager licenseKey={licenseDetails.license_key} />
                </section>
            )}

            {canManageStaff && licenseDetails?.valid && (
                <section className="license-panel license-staff-panel">
                    <StaffUsersSettings licenseKey={licenseDetails.license_key} />
                </section>
            )}
        </div>
    );
}
