// components/pos/LayawayModal.jsx - VERSIÓN CORREGIDA
import React, { useState, useEffect } from 'react';
import { loadData, STORES } from '../../services/database';
import QuickAddCustomerModal from '../common/QuickAddCustomerModal';
import { useCaja } from '../../hooks/useCaja'; // ✅ AGREGADO
import { showMessageModal } from '../../services/utils';
import Logger from '../../services/Logger';
import './LayawayModal.css';

export default function LayawayModal({ show, onClose, onConfirm, total, customer: preSelectedCustomer }) {
    const [initialPayment, setInitialPayment] = useState('');
    const [deadline, setDeadline] = useState('');
    
    const [customers, setCustomers] = useState([]);
    const [customerSearch, setCustomerSearch] = useState('');
    const [filteredCustomers, setFilteredCustomers] = useState([]);
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);

    // ✅ NUEVO: Hook de caja
    const { cajaActual } = useCaja();

    useEffect(() => {
        if (show) {
            const date = new Date();
            date.setDate(date.getDate() + 30);
            setDeadline(date.toISOString().split('T')[0]);
            setInitialPayment('');

            const fetchCustomers = async () => {
                const data = await loadData(STORES.CUSTOMERS);
                setCustomers(data || []);
            };
            fetchCustomers();

            if (preSelectedCustomer) {
                setSelectedCustomer(preSelectedCustomer);
            } else {
                setSelectedCustomer(null);
                setCustomerSearch('');
            }
            setFilteredCustomers([]);
        }
    }, [show, preSelectedCustomer, total]);

    const handleCustomerSearch = (e) => {
        const query = e.target.value;
        setCustomerSearch(query);
        if (query.trim().length > 2) {
            const filtered = customers.filter(c =>
                c.name.toLowerCase().includes(query.toLowerCase()) ||
                c.phone.includes(query)
            );
            setFilteredCustomers(filtered);
        } else {
            setFilteredCustomers([]);
        }
    };

    const handleCustomerClick = (customer) => {
        setSelectedCustomer(customer);
        setCustomerSearch('');
        setFilteredCustomers([]);
    };

    const handleQuickCustomerSaved = (newCustomer) => {
        setCustomers(prev => [...prev, newCustomer]);
        setSelectedCustomer(newCustomer);
        setIsQuickAddOpen(false);
    };

    if (!show) return null;

    const initialAmount = Number(initialPayment) || 0;
    const remaining = total - initialAmount;
    const percentage = total > 0 ? (initialAmount / total) * 100 : 0;

    const handleSubmit = (e) => {
        e.preventDefault();

        // ✅ VALIDACIÓN 1: CLIENTE OBLIGATORIO
        if (!selectedCustomer) {
            alert("Es obligatorio asignar un cliente.");
            return;
        }

        // ✅ VALIDACIÓN 2: MONTO COHERENTE
        if (remaining < 0) {
            alert("El abono no puede ser mayor al total.");
            return;
        }

        // ✅ VALIDACIÓN 3: CAJA ABIERTA (SI HAY ABONO INICIAL)
        if (initialAmount > 0 && (!cajaActual || cajaActual.estado !== 'abierta')) {
            showMessageModal(
                '⚠️ CAJA CERRADA\n\nNecesitas abrir una caja antes de recibir el abono inicial.',
                null,
                { type: 'warning' }
            );
            return;
        }

        // ✅ VALIDACIÓN 4: LÍMITE DE CRÉDITO
        const deudaActual = selectedCustomer.debt || 0;
        const limiteCredito = selectedCustomer.creditLimit || 0;

        if (limiteCredito > 0 && (deudaActual + remaining) > limiteCredito) {
            showMessageModal(
                `⚠️ LÍMITE DE CRÉDITO EXCEDIDO\n\n` +
                `Cliente: ${selectedCustomer.name}\n` +
                `Deuda actual: $${deudaActual.toFixed(2)}\n` +
                `Saldo apartado: $${remaining.toFixed(2)}\n` +
                `Total acumulado: $${(deudaActual + remaining).toFixed(2)}\n\n` +
                `Límite configurado: $${limiteCredito.toFixed(2)}\n\n` +
                `Opciones:\n` +
                `• Aumentar el abono inicial\n` +
                `• Incrementar el límite del cliente\n` +
                `• Elegir menos productos`,
                null,
                { type: 'error' }
            );
            return;
        }

        // ✅ TODO OK - PROCEDER
        onConfirm({
            initialPayment: initialAmount,
            deadline,
            customer: selectedCustomer,
            cajaId: cajaActual?.id || null // ✅ PASAMOS EL ID DE LA CAJA
        });
    };

    return (
        <>
            <div className="layaway-modal-overlay">
                <div className="layaway-modal-content">
                    
                    {/* Header */}
                    <div className="layaway-header">
                        <h2>📦 Nuevo Apartado</h2>
                        <button className="btn-close-x" onClick={onClose}>&times;</button>
                    </div>

                    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                        <div className="layaway-body">
                            
                            {/* SECCIÓN 1: CLIENTE */}
                            <div className="layaway-section-title">Información del Cliente</div>
                            
                            {!selectedCustomer ? (
                                <div className="customer-search-group">
                                    <input
                                        className="input-search-custom"
                                        type="text"
                                        placeholder="Buscar cliente (Nombre o Tel)..."
                                        value={customerSearch}
                                        onChange={handleCustomerSearch}
                                        autoFocus
                                    />
                                    <button 
                                        type="button" 
                                        className="btn-new-customer"
                                        onClick={() => setIsQuickAddOpen(true)}
                                    >
                                        + Nuevo
                                    </button>

                                    {filteredCustomers.length > 0 && (
                                        <div className="search-dropdown">
                                            {filteredCustomers.map(c => (
                                                <div 
                                                    key={c.id} 
                                                    className="search-item"
                                                    onClick={() => handleCustomerClick(c)}
                                                >
                                                    <strong>{c.name}</strong> <small>({c.phone})</small>
                                                    {c.creditLimit > 0 && (
                                                        <span style={{fontSize:'0.75rem', color:'#718096'}}>
                                                            {' '}Límite: ${c.creditLimit}
                                                        </span>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="selected-customer-card">
                                    <div className="customer-info">
                                        <strong>{selectedCustomer.name}</strong>
                                        <span>📞 {selectedCustomer.phone}</span>
                                        {/* ✅ MOSTRAR INFO DE CRÉDITO */}
                                        {selectedCustomer.creditLimit > 0 && (
                                            <span style={{fontSize:'0.8rem', color:'#4a5568'}}>
                                                💳 Límite: ${selectedCustomer.creditLimit} | 
                                                Deuda: ${(selectedCustomer.debt || 0).toFixed(2)}
                                            </span>
                                        )}
                                    </div>
                                    <button 
                                        type="button" 
                                        className="btn-change-customer"
                                        onClick={() => setSelectedCustomer(null)}
                                    >
                                        Cambiar
                                    </button>
                                </div>
                            )}

                            {/* SECCIÓN 2: FINANZAS */}
                            <div className="layaway-section-title">Plan de Pago</div>
                            
                            <div className="financial-grid">
                                <div className="input-group">
                                    <label>Abono Inicial</label>
                                    <div className="input-currency-wrapper">
                                        <span className="currency-symbol">$</span>
                                        <input 
                                            type="number" 
                                            className="input-financial"
                                            value={initialPayment}
                                            onChange={e => setInitialPayment(e.target.value)}
                                            step="0.01"
                                            min="0"
                                            max={total}
                                            placeholder="0.00"
                                            required
                                        />
                                    </div>
                                    <small style={{ fontSize: '0.75rem', color: '#b2bec3' }}>
                                        Mínimo sugerido: ${(total * 0.10).toFixed(2)}
                                    </small>
                                    {/* ✅ ADVERTENCIA SI NO HAY CAJA */}
                                    {initialAmount > 0 && (!cajaActual || cajaActual.estado !== 'abierta') && (
                                        <small style={{ fontSize: '0.75rem', color: '#e53e3e', marginTop: '5px', display: 'block' }}>
                                            ⚠️ Necesitas abrir una caja primero
                                        </small>
                                    )}
                                </div>

                                <div className="input-group">
                                    <label>Fecha Límite</label>
                                    <input 
                                        type="date" 
                                        className="input-financial"
                                        style={{ paddingLeft: '10px' }}
                                        value={deadline}
                                        onChange={e => setDeadline(e.target.value)}
                                        required
                                    />
                                </div>
                            </div>

                            {/* SECCIÓN 3: RESUMEN VISUAL */}
                            <div className="summary-box">
                                <div className="summary-row row-total">
                                    <span>Total del Pedido:</span>
                                    <span>${total.toFixed(2)}</span>
                                </div>
                                <div className="summary-row">
                                    <span>Abono Inicial ({percentage.toFixed(0)}%):</span>
                                    <span className="row-advance">- ${initialAmount.toFixed(2)}</span>
                                </div>
                                <div className="summary-row row-remaining">
                                    <span>Restante por Pagar:</span>
                                    <span>${remaining.toFixed(2)}</span>
                                </div>

                                <div className="progress-bar-bg">
                                    <div 
                                        className="progress-bar-fill" 
                                        style={{ width: `${Math.min(percentage, 100)}%` }}
                                    ></div>
                                </div>
                                <div style={{ textAlign: 'center', marginTop: '5px', fontSize: '0.75rem', color: '#636e72' }}>
                                    {percentage < 100 ? 'Pendiente de liquidación' : '¡Liquidado totalmente!'}
                                </div>
                            </div>

                        </div>

                        {/* Footer */}
                        <div className="layaway-footer">
                            <button 
                                type="submit" 
                                className="btn-confirm-layaway"
                                disabled={
                                    !selectedCustomer || 
                                    remaining < 0 || 
                                    initialAmount < 0 ||
                                    (initialAmount > 0 && (!cajaActual || cajaActual.estado !== 'abierta'))
                                }
                            >
                                CONFIRMAR APARTADO
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            {isQuickAddOpen && (
                <QuickAddCustomerModal
                    show={true}
                    onClose={() => setIsQuickAddOpen(false)}
                    onCustomerSaved={handleQuickCustomerSaved}
                />
            )}
        </>
    );
}