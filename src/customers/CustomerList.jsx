// src/components/customers/CustomerList.jsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import CustomerCard from './CustomerCard'; // <--- 1. IMPORTAR EL NUEVO COMPONENTE
import './CustomerList.css';

export default function CustomerList({
    customers,
    isLoading,
    onEdit,
    onDelete,
    onViewHistory,
    onAbonar,
    onWhatsApp,
    onWhatsAppLoading
}) {
    // ... (Mantén toda tu lógica de estado, refs y observer igual) ...
    const [displayLimit, setDisplayLimit] = useState(20);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const observerRef = useRef(null);
    const sentinelRef = useRef(null);

    const sortedCustomers = useMemo(() => {
        return [...customers].sort((a, b) => (b.debt || 0) - (a.debt || 0));
    }, [customers]);

    useEffect(() => { setDisplayLimit(20); }, [customers]);

    const visibleCustomers = sortedCustomers.slice(0, displayLimit);
    const hasMore = displayLimit < sortedCustomers.length;

    // ... (Mantén tu useEffect del IntersectionObserver igual) ...
    useEffect(() => {
        if (isLoadingMore || !hasMore) return;
        const observerCallback = (entries) => {
            const [entry] = entries;
            if (entry.isIntersecting) {
                setIsLoadingMore(true);
                setTimeout(() => {
                    setDisplayLimit((prev) => prev + 20);
                    setIsLoadingMore(false);
                }, 300);
            }
        };
        const options = { root: null, rootMargin: '100px', threshold: 0.1 };
        observerRef.current = new IntersectionObserver(observerCallback, options);
        if (sentinelRef.current) observerRef.current.observe(sentinelRef.current);
        return () => { if (observerRef.current) observerRef.current.disconnect(); };
    }, [isLoadingMore, hasMore]);

    // --- RENDERS ---

    if (isLoading) {
        return (
            <div style={{ padding: '40px', textAlign: 'center' }}>
                <div className="spinner-loader"></div>
                <p style={{ marginTop: '10px', color: 'var(--text-light)' }}>Cargando clientes...</p>
            </div>
        );
    }

    if (customers.length === 0) {
        return <div className="customer-empty-message">No hay clientes registrados.</div>;
    }

    return (
        <div className="customer-list-container">
            {/* Lista Grid */}
            <div id="customer-list" className="customer-list" aria-label="Lista de clientes">
                {visibleCustomers.map((customer) => (
                    // --- 2. USAR EL COMPONENTE MEMOIZADO ---
                    <CustomerCard
                        key={customer.id}
                        customer={customer}
                        // Aquí ocurre la magia: Calculamos el booleano y lo pasamos.
                        // Si 'onWhatsAppLoading' cambia, solo 2 tarjetas verán un cambio en sus props:
                        // la que estaba cargando (pasa a false) y la nueva (pasa a true).
                        isWhatsAppLoading={onWhatsAppLoading === customer.id}
                        onEdit={onEdit}
                        onDelete={onDelete}
                        onViewHistory={onViewHistory}
                        onAbonar={onAbonar}
                        onWhatsApp={onWhatsApp}
                    />
                ))}
            </div>

            {/* ... (Mantén el sentinel y el contador igual) ... */}
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
                Mostrando {visibleCustomers.length} de {sortedCustomers.length} clientes
            </div>
        </div>
    );
}