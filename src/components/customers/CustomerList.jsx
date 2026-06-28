import { useState, useEffect, useRef, useMemo } from 'react';
import { Users, Settings } from 'lucide-react';
import CustomerCard from './CustomerCard';
import { useAppStore } from '../../store/useAppStore'; // Para guardar la config global
import { customerCreditRepository } from '../../services/db/customerCreditRepository';
import { showMessageModal } from '../../services/utils';
import './CustomerList.css';

// --- SUB-COMPONENTE: Modal de Configuración de Crédito ---
const CreditConfigModal = ({ isOpen, onClose, currentGlobal, onSaveGlobal, isSaving }) => {
    const [limit, setLimit] = useState(currentGlobal);
    const [applyToAll, setApplyToAll] = useState(false);

    useEffect(() => { setLimit(currentGlobal); }, [currentGlobal, isOpen]);

    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '400px' }}>
                <h3 className="modal-title">Configuración de Crédito</h3>
                <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '15px' }}>
                    Define el monto máximo que se puede fiar por defecto a los clientes.
                </p>

                <div className="form-group">
                    <label className="form-label">Límite Global ($)</label>
                    <input
                        type="number"
                        className="form-input"
                        value={limit}
                        onChange={(e) => setLimit(parseFloat(e.target.value) || 0)}
                        min="0"
                    />
                </div>

                <div style={{
                    marginTop: '15px',
                    padding: '10px',
                    background: '#fff3cd',
                    borderRadius: '6px',
                    border: '1px solid #ffeeba',
                    fontSize: '0.85rem'
                }}>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={applyToAll}
                            onChange={(e) => setApplyToAll(e.target.checked)}
                            style={{ marginTop: '3px' }}
                        />
                        <span>
                            <strong>Aplicar a todos los clientes existentes</strong>
                            <br />
                            <span style={{ color: '#856404' }}>Cuidado: Esto sobrescribirá los límites personalizados de todos los clientes registrados.</span>
                        </span>
                    </label>
                </div>

                <div className="modal-actions" style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                    <button className="btn btn-cancel" onClick={onClose} disabled={isSaving}>Cancelar</button>
                    <button
                        className="btn btn-save"
                        onClick={() => onSaveGlobal(limit, applyToAll)}
                        disabled={isSaving}
                    >
                        {isSaving ? 'Guardando...' : 'Guardar Configuración'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default function CustomerList({
    customers,
    isLoading,
    isLoadingMore,
    hasMore,
    onLoadMore,
    onRefreshList,
    onEdit,
    onDelete,
    onViewHistory,
    onAbonar,
    onViewLayaways,
    onWhatsApp,
    onWhatsAppLoading
}) {
    // --- ESTADOS Y STORES ---
    const globalCreditLimit = useAppStore(
        (state) => state.companyProfile?.settings_default_credit_limit || 0
    );
    const updateCompanyProfile = useAppStore((state) => state.updateCompanyProfile);

    const [showConfigModal, setShowConfigModal] = useState(false);
    const [isSavingConfig, setIsSavingConfig] = useState(false);

    const observerRef = useRef(null);
    const sentinelRef = useRef(null);

    const safeCustomers = useMemo(() => (
        Array.isArray(customers) ? customers : []
    ), [customers]);

    // --- INFINITE SCROLL ---
    useEffect(() => {
        if (isLoadingMore || !hasMore || typeof onLoadMore !== 'function') return;
        const observerCallback = (entries) => {
            const [entry] = entries;
            if (entry.isIntersecting) {
                onLoadMore();
            }
        };
        const options = { root: null, rootMargin: '100px', threshold: 0.1 };
        observerRef.current = new IntersectionObserver(observerCallback, options);
        if (sentinelRef.current) observerRef.current.observe(sentinelRef.current);
        return () => { if (observerRef.current) observerRef.current.disconnect(); };
    }, [hasMore, isLoadingMore, onLoadMore]);

    // --- MANEJADORES DE CONFIGURACIÓN ---
    const handleSaveGlobalLimit = async (newLimit, applyToAll) => {
        setIsSavingConfig(true);
        try {
            const companyProfile = useAppStore.getState().companyProfile;
            await updateCompanyProfile({
                ...companyProfile,
                settings_default_credit_limit: newLimit
            });

            if (applyToAll) {
                // Nota crítica: Al pasar 'true', estás DESTRUYENDO cualquier límite 
                // personalizado que le hayas dado a un cliente en específico.
                await customerCreditRepository.bulkUpdateCreditLimits(newLimit, true);

                // Obligamos al componente padre a vaciar su estado local 
                // y volver a consultar la base de datos desde la página 1.
                if (typeof onRefreshList === 'function') {
                    await onRefreshList();
                } else {
                    console.warn("Se requiere onRefreshList para actualizar la UI después de cambios masivos.");
                }
            }
            setShowConfigModal(false);
        } catch (error) {
            console.error("Error guardando config:", error);
            showMessageModal("Hubo un error al guardar la configuración.", null, { type: 'error' });
        } finally {
            setIsSavingConfig(false);
        }
    };

    // --- RENDERS ---

    if (isLoading) {
        return (
            <div className="customer-loading-state" role="status">
                <div className="spinner-loader"></div>
                <p>Cargando clientes...</p>
            </div>
        );
    }

    if (safeCustomers.length === 0) {
        return (
            <div className="customer-empty-message">
                <span className="customer-empty-icon">
                    <Users size={30} aria-hidden="true" />
                </span>
                <p>No hay clientes registrados.</p>
                <span className="customer-empty-copy">
                    Haz clic en Añadir Cliente para comenzar.
                </span>
                {/* Botón de config inicial */}
                <button
                    className="customer-config-button"
                    onClick={() => setShowConfigModal(true)}
                >
                    <Settings size={14} /> Configurar Límite de Crédito
                </button>
                <CreditConfigModal
                    isOpen={showConfigModal}
                    onClose={() => setShowConfigModal(false)}
                    currentGlobal={globalCreditLimit}
                    onSaveGlobal={handleSaveGlobalLimit}
                    isSaving={isSavingConfig}
                />
            </div>
        );
    }

    return (
        <div className="customer-list-container">
            {/* Cabecera de Resumen de Crédito */}
            <div className="customer-directory-toolbar">
                <div className="customer-directory-heading">
                    <p>Directorio activo</p>
                    <h2>Registros de clientes</h2>
                </div>
                <button
                    className="customer-config-button"
                    onClick={() => setShowConfigModal(true)}
                >
                    <Settings size={18} aria-hidden="true" />
                    Configurar Límites
                </button>
            </div>

            <div className="customer-list-columns" aria-hidden="true">
                <span>Cliente</span>
                <span>Contacto y direccion</span>
                <span>Estado</span>
                <span>Deuda actual</span>
                <span>Acciones</span>
            </div>

            <div id="customer-list" className="customer-list" aria-label="Lista de clientes">
                {safeCustomers.map((customer) => (
                    <CustomerCard
                        key={customer.id}
                        customer={customer}
                        isWhatsAppLoading={onWhatsAppLoading === customer.id}
                        onEdit={onEdit}
                        onDelete={onDelete}
                        onViewHistory={onViewHistory}
                        onAbonar={onAbonar}
                        onViewLayaways={onViewLayaways}
                        onWhatsApp={onWhatsApp}
                        // Pasamos props extra si CustomerCard las acepta para visualización
                        // (Si no modificas CustomerCard, esto se ignora sin error)
                        globalLimit={globalCreditLimit}
                    />
                ))}
            </div>

            {hasMore && (
                <div
                    ref={sentinelRef}
                    className="sentinel-loader"
                    role="status"
                >
                    {isLoadingMore && <div className="spinner-loader small"></div>}
                </div>
            )}

            <div className="customer-list-footer">
                Mostrando {safeCustomers.length} cliente{safeCustomers.length === 1 ? '' : 's'}{hasMore ? '...' : ''}
            </div>

            {/* Modal de Configuración */}
            <CreditConfigModal
                isOpen={showConfigModal}
                onClose={() => setShowConfigModal(false)}
                currentGlobal={globalCreditLimit}
                onSaveGlobal={handleSaveGlobalLimit}
                isSaving={isSavingConfig}
            />
        </div>
    );
}


