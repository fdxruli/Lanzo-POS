import React, { useState, useEffect, useRef, useMemo } from 'react';
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
    // Estado para controlar cuántos se muestran
    const [displayLimit, setDisplayLimit] = useState(20);
    const [isLoadingMore, setIsLoadingMore] = useState(false);

    // Referencias para el Scroll Infinito
    const observerRef = useRef(null);
    const sentinelRef = useRef(null);

    // 1. Ordenar clientes (Memoria) - Prioridad a los deudores
    const sortedCustomers = useMemo(() => {
        return [...customers].sort((a, b) => (b.debt || 0) - (a.debt || 0));
    }, [customers]);

    // 2. Resetear límite si cambia la base de datos (ej. búsqueda o recarga)
    useEffect(() => {
        setDisplayLimit(20);
    }, [customers]);

    // 3. Lógica de lista visible
    const visibleCustomers = sortedCustomers.slice(0, displayLimit);
    const hasMore = displayLimit < sortedCustomers.length;

    // 4. Intersection Observer (El motor del Scroll Infinito)
    useEffect(() => {
        if (isLoadingMore || !hasMore) return;

        const observerCallback = (entries) => {
            const [entry] = entries;
            if (entry.isIntersecting) {
                setIsLoadingMore(true);

                // Pequeño delay para suavizar la UI y mostrar el spinner
                setTimeout(() => {
                    setDisplayLimit((prev) => prev + 20);
                    setIsLoadingMore(false);
                }, 300);
            }
        };

        const options = {
            root: null, // Viewport del navegador
            rootMargin: '100px', // Cargar 100px antes de llegar al final
            threshold: 0.1
        };

        observerRef.current = new IntersectionObserver(observerCallback, options);

        if (sentinelRef.current) {
            observerRef.current.observe(sentinelRef.current);
        }

        return () => {
            if (observerRef.current) observerRef.current.disconnect();
        };
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
        return <div className="empty-message">No hay clientes registrados.</div>;
    }

    return (
        <div className="customer-list-container">
            {/* Lista Grid */}
            <div id="customer-list" className="customer-list" aria-label="Lista de clientes">
                {visibleCustomers.map((customer) => {
                    const hasDebt = customer.debt && customer.debt > 0;
                    const isWhatsAppLoading = onWhatsAppLoading === customer.id;

                    return (
                        <div key={customer.id} className={`customer-card ${hasDebt ? 'has-debt' : ''}`}>
                            <div className="customer-info">
                                <h4>{customer.name}</h4>
                                <p><strong>Teléfono:</strong> {customer.phone}</p>
                                <p><strong>Dirección:</strong> {customer.address}</p>

                                {hasDebt && (
                                    <p className="customer-debt">
                                        <strong>Deuda:</strong> ${customer.debt.toFixed(2)}
                                    </p>
                                )}
                            </div>

                            <div className="customer-actions">
                                {hasDebt && (
                                    <button
                                        className="btn btn-abono"
                                        onClick={() => onAbonar(customer)}
                                    >
                                        Abonar
                                    </button>
                                )}

                                {customer.phone && (
                                    <button
                                        className="btn btn-whatsapp"
                                        title={hasDebt ? "Enviar recordatorio" : "Chat"}
                                        onClick={() => onWhatsApp(customer)}
                                        disabled={isWhatsAppLoading}
                                    >
                                        {isWhatsAppLoading ? '...' : (hasDebt ? 'Cobrar' : 'Chat')}
                                    </button>
                                )}

                                <button
                                    className="btn btn-history"
                                    onClick={() => onViewHistory(customer)}
                                >
                                    Historial
                                </button>
                                <button className="btn btn-edit" onClick={() => onEdit(customer)}>
                                    ✏️
                                </button>
                                <button className="btn btn-delete" onClick={() => onDelete(customer.id)}>
                                    🗑️
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* --- SENTINEL (El elemento invisible que detecta el final) --- */}
            {hasMore && (
                <div
                    ref={sentinelRef}
                    className="sentinel-loader"
                    style={{
                        height: '60px',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        marginTop: '20px'
                    }}
                >
                    {isLoadingMore && <div className="spinner-loader small"></div>}
                </div>
            )}

            {/* Contador Informativo */}
            <div style={{ textAlign: 'center', color: '#999', fontSize: '0.8rem', marginTop: '10px', paddingBottom: '20px' }}>
                Mostrando {visibleCustomers.length} de {sortedCustomers.length} clientes
            </div>
        </div>
    );
}