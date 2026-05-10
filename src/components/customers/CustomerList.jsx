import { useState, useEffect, useRef, useMemo } from 'react';
import { Users, Settings, AlertTriangle } from 'lucide-react';
import CustomerCard from './CustomerCard';
import { useAppStore } from '../../store/useAppStore'; // Para guardar la config global
import { customerCreditRepository } from '../../services/db/customerCreditRepository';
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
    const { companyProfile, updateCompanyProfile } = useAppStore();

    // Obtenemos el límite global del perfil de la empresa (o 0 si no existe)
    // Usamos un campo personalizado en el perfil llamado 'settings_default_credit_limit'
    const globalCreditLimit = useMemo(() => {
        return companyProfile?.settings_default_credit_limit || 0;
    }, [companyProfile]);

    const [showConfigModal, setShowConfigModal] = useState(false);
    const [isSavingConfig, setIsSavingConfig] = useState(false);

    const observerRef = useRef(null);
    const sentinelRef = useRef(null);

    const safeCustomers = useMemo(() => (
        Array.isArray(customers) ? customers : []
    ), [customers]);

    const stats = useMemo(() => {
        const totalDebt = safeCustomers.reduce((acc, c) => acc + (parseFloat(c.debt) || 0), 0);

        const overLimitCount = safeCustomers.filter(c => {
            const debtVal = parseFloat(c.debt) || 0;
            const limitVal = parseFloat(c.creditLimit) || 0;
            return debtVal > limitVal && limitVal > 0;
        }).length;

        return { totalDebt, overLimitCount };
    }, [safeCustomers]);

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
            alert("Hubo un error al guardar la configuración.");
        } finally {
            setIsSavingConfig(false);
        }
    };

    // --- RENDERS ---

    if (isLoading) {
        return (
            <div style={{ padding: '40px', textAlign: 'center' }}>
                <div className="spinner-loader"></div>
                <p style={{ marginTop: '10px', color: 'var(--text-light)' }}>Cargando clientes...</p>
            </div>
        );
    }

    if (safeCustomers.length === 0) {
        return (
            <div className="customer-empty-message">
                <Users size={48} style={{ opacity: 0.3 }} />
                <p>No hay clientes registrados.</p>
                <span style={{ fontSize: '0.85rem', opacity: 0.8 }}>
                    Haz clic en Añadir Cliente para comenzar.
                </span>
                {/* Botón de config inicial */}
                <button
                    className="btn-text"
                    onClick={() => setShowConfigModal(true)}
                    style={{ marginTop: '20px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '5px' }}
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
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '15px',
                padding: '10px 15px',
                backgroundColor: 'var(--bg-light)',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                flexWrap: 'wrap',
                gap: '10px'
            }}>
                <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                    <div title="Deuda total en la calle">
                        <span style={{ fontSize: '0.75rem', color: '#718096', textTransform: 'uppercase' }}>Fiado Total</span>
                        <div style={{ fontWeight: 'bold', fontSize: '1.1rem', color: 'var(--primary-color)' }}>
                            ${stats.totalDebt.toFixed(2)}
                        </div>
                    </div>
                    {stats.overLimitCount > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#e53e3e' }}>
                            <AlertTriangle size={16} />
                            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                                {stats.overLimitCount} clientes excedidos
                            </span>
                        </div>
                    )}
                </div>

                <button
                    className="btn btn-secondary small"
                    onClick={() => setShowConfigModal(true)}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}
                >
                    <Settings size={14} />
                    Configurar Límites
                </button>
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
                    style={{
                        height: '60px', display: 'flex', justifyContent: 'center',
                        alignItems: 'center', marginTop: '20px'
                    }}
                >
                    {isLoadingMore && <div className="spinner-loader small"></div>}
                </div>
            )}

            <div style={{ textAlign: 'center', color: '#999', fontSize: '0.8rem', marginTop: '10px', paddingBottom: '20px' }}>
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


