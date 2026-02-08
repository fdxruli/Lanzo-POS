import React, { useState, useEffect } from 'react';
import {
    Package, Calendar, DollarSign, CheckCircle, XCircle,
    AlertTriangle, Clock, ShoppingBag, ChevronRight
} from 'lucide-react';
import { layawayRepository } from '../../services/db/layaways';
import { useCaja } from '../../hooks/useCaja';
import { showMessageModal } from '../../services/utils';
import Logger from '../../services/Logger';
import './LayawayModal.css';

export default function LayawayModal({ show, onClose, customer, onUpdate }) {
    const [layaways, setLayaways] = useState([]);
    const [loading, setLoading] = useState(false);
    const [processingId, setProcessingId] = useState(null);

    // Estado para abonos
    const [paymentAmount, setPaymentAmount] = useState('');
    const [activePaymentId, setActivePaymentId] = useState(null); // ID del apartado que se está abonando

    const { registrarMovimiento, cajaActual } = useCaja();

    useEffect(() => {
        if (show && customer) {
            loadLayaways();
        } else {
            setLayaways([]);
            setPaymentAmount('');
            setActivePaymentId(null);
        }
    }, [show, customer]);

    const loadLayaways = async () => {
        setLoading(true);
        try {
            const active = await layawayRepository.getByCustomer(customer.id, true);
            // Ordenar: Más recientes primero
            active.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            setLayaways(active);
        } catch (error) {
            Logger.error("Error cargando apartados", error);
            showMessageModal("Error al cargar los apartados del cliente.");
        } finally {
            setLoading(false);
        }
    };

    const handleAddPayment = async (layaway) => {
        if (!cajaActual || cajaActual.estado !== 'abierta') {
            showMessageModal('⚠️ Necesitas una caja abierta para recibir dinero.');
            return;
        }

        const amount = parseFloat(paymentAmount);
        const deudaPendiente = layaway.totalAmount - layaway.paidAmount;

        if (!amount || amount <= 0) return showMessageModal('Ingresa un monto válido.', null, { type: 'warning' });
        // Permitimos un pequeño margen de error por decimales (0.01)
        if (amount > deudaPendiente + 0.1) return showMessageModal('El monto excede la deuda pendiente.', null, { type: 'warning' });

        setProcessingId(layaway.id);
        try {
            const movExito = await registrarMovimiento(
                'entrada',
                amount,
                `Abono Apartado #${layaway.id.slice(-4)} - ${customer.name}`
            );

            if (!movExito) throw new Error("No se pudo registrar en caja.");

            await layawayRepository.addPayment(layaway.id, amount);

            showMessageModal('✅ Abono registrado correctamente.');
            setPaymentAmount('');
            setActivePaymentId(null);
            loadLayaways();
            if (onUpdate) onUpdate();

        } catch (error) {
            Logger.error("Error en abono apartado", error);
            showMessageModal(`Error: ${error.message}`);
        } finally {
            setProcessingId(null);
        }
    };

    const handleDeliver = async (layaway) => {
        const pending = layaway.totalAmount - layaway.paidAmount;
        if (pending > 0.50) {
            showMessageModal(`⚠️ Saldo pendiente de $${pending.toFixed(2)}. Liquídalo primero.`);
            return;
        }

        if (!window.confirm("¿Confirmar entrega de mercancía? Se registrará la venta histórica.")) return;

        setProcessingId(layaway.id);
        try {
            await layawayRepository.convertToSale(layaway.id);
            showMessageModal('🎉 ¡Mercancía entregada! Apartado finalizado.');
            loadLayaways();
            if (onUpdate) onUpdate();
        } catch (error) {
            Logger.error("Error entregando apartado", error);
            showMessageModal(`Error al entregar: ${error.message}`);
        } finally {
            setProcessingId(null);
        }
    };

    const handleCancel = async (layaway) => {
        if (!window.confirm("¿CANCELAR apartado? El stock será devuelto al inventario.")) return;

        setProcessingId(layaway.id);
        try {
            await layawayRepository.cancel(layaway.id, "Cancelado por usuario");
            let msg = 'Apartado cancelado. Stock restaurado.';
            if (layaway.paidAmount > 0) {
                msg += ` ℹ️ Devolver $${layaway.paidAmount.toFixed(2)} al cliente.`;
            }
            showMessageModal(msg);
            loadLayaways();
            if (onUpdate) onUpdate();
        } catch (error) {
            Logger.error("Error cancelando apartado", error);
            showMessageModal(`Error: ${error.message}`);
        } finally {
            setProcessingId(null);
        }
    };

    const getDaysElapsed = (dateString) => {
        const start = new Date(dateString);
        const now = new Date();
        const diffTime = Math.abs(now - start);
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
    };

    if (!show || !customer) return null;

    return (
        <div className="modal" style={{ display: 'flex', zIndex: 8001 }}>
            <div className="modal-content layaway-modal-content">
                
                {/* Header */}
                <div className="modal-header">
                    <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '1.2rem' }}>
                        <Package className="text-primary" size={24} />
                        <div>
                            <span>Apartados</span>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-light)', fontWeight: 'normal', display: 'block' }}>
                                {customer.name}
                            </span>
                        </div>
                    </h2>
                    <button className="close-btn" onClick={onClose}>&times;</button>
                </div>

                {/* Body */}
                <div className="layaway-modal-body">
                    {loading ? (
                        <div className="layaway-empty-state">
                            <div className="spinner"></div>
                            <p>Cargando...</p>
                        </div>
                    ) : layaways.length === 0 ? (
                        <div className="layaway-empty-state">
                            <Package size={64} strokeWidth={1} />
                            <h3>Sin Apartados</h3>
                            <p>Este cliente no tiene apartados activos.</p>
                        </div>
                    ) : (
                        <div className="layaways-list">
                            {layaways.map(layaway => {
                                const pending = layaway.totalAmount - (layaway.paidAmount || 0);
                                const progress = (layaway.paidAmount / layaway.totalAmount) * 100;
                                const isReady = pending <= 0.1;
                                const daysElapsed = getDaysElapsed(layaway.createdAt);
                                const isPayingThis = activePaymentId === layaway.id;

                                return (
                                    <div key={layaway.id} className="layaway-card">
                                        
                                        {/* 1. Header de Tarjeta */}
                                        <div className="layaway-card-header">
                                            <div className="layaway-meta">
                                                <div className="layaway-date">
                                                    <Calendar size={16} />
                                                    {new Date(layaway.createdAt).toLocaleDateString()}
                                                </div>
                                                <span style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>
                                                    Hace {daysElapsed} días • Ref: {layaway.id.slice(-6)}
                                                </span>
                                            </div>
                                            <div className={`layaway-status-badge ${isReady ? 'ready' : 'pending'}`}>
                                                {isReady ? 'Listo' : 'Pendiente'}
                                            </div>
                                        </div>

                                        {/* 2. Productos (Diseño Híbrido) */}
                                        <div className="layaway-products-container">
                                            {/* Versión Escritorio */}
                                            <table className="desktop-table">
                                                <thead>
                                                    <tr>
                                                        <th>Producto</th>
                                                        <th style={{textAlign: 'center'}}>Cant.</th>
                                                        <th style={{textAlign: 'right'}}>Total</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {layaway.items.map((item, idx) => (
                                                        <tr key={idx}>
                                                            <td>
                                                                {item.name}
                                                                {item.variantName && <small style={{display:'block', color:'gray'}}>{item.variantName}</small>}
                                                            </td>
                                                            <td style={{textAlign: 'center'}}>x{item.quantity}</td>
                                                            <td style={{textAlign: 'right'}}>${(item.price * item.quantity).toFixed(2)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>

                                            {/* Versión Móvil */}
                                            <div className="mobile-product-list">
                                                {layaway.items.map((item, idx) => (
                                                    <div key={idx} className="mobile-item">
                                                        <div className="m-item-info">
                                                            <span className="m-item-name">{item.name} {item.variantName ? `(${item.variantName})` : ''}</span>
                                                            <span className="m-item-qty">{item.quantity} ud. a ${item.price}</span>
                                                        </div>
                                                        <span className="m-item-total">${(item.price * item.quantity).toFixed(2)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {/* 3. Finanzas (Grid) */}
                                        <div className="layaway-financial-section">
                                            <div className="financial-grid">
                                                <div className="finance-block">
                                                    <span className="finance-label">Total</span>
                                                    <span className="finance-value total">${layaway.totalAmount.toFixed(2)}</span>
                                                </div>
                                                <div className="finance-block">
                                                    <span className="finance-label">Abonado</span>
                                                    <span className="finance-value paid">${layaway.paidAmount.toFixed(2)}</span>
                                                </div>
                                                <div className="finance-block">
                                                    <span className="finance-label">Resta</span>
                                                    <span className="finance-value debt">${pending.toFixed(2)}</span>
                                                </div>
                                            </div>
                                            <div className="progress-container">
                                                <div 
                                                    className={`progress-fill ${isReady ? 'ready' : 'pending'}`}
                                                    style={{ width: `${progress}%` }}
                                                ></div>
                                            </div>
                                        </div>

                                        {/* 4. Footer de Acciones */}
                                        <div className="layaway-card-footer">
                                            
                                            {/* A) Modo Normal: Botón de Abonar grande y Botones de gestión */}
                                            {!isPayingThis && !isReady && (
                                                <button 
                                                    className="btn-start-payment"
                                                    onClick={() => {
                                                        setActivePaymentId(layaway.id);
                                                        setPaymentAmount('');
                                                    }}
                                                >
                                                    <DollarSign size={20} /> Registrar Nuevo Abono
                                                </button>
                                            )}

                                            {/* B) Modo Abono: Formulario Expandido */}
                                            {isPayingThis && (
                                                <div className="payment-zone">
                                                    <label style={{fontWeight:'600', fontSize:'0.9rem'}}>¿Cuánto desea abonar?</label>
                                                    <div className="payment-input-row">
                                                        <span className="payment-currency">$</span>
                                                        <input 
                                                            type="number" 
                                                            className="payment-input-large"
                                                            placeholder="0.00"
                                                            autoFocus
                                                            value={paymentAmount}
                                                            onChange={(e) => setPaymentAmount(e.target.value)}
                                                            onKeyDown={(e) => e.key === 'Enter' && handleAddPayment(layaway)}
                                                        />
                                                    </div>
                                                    <div className="payment-actions-row">
                                                        <button 
                                                            className="btn btn-primary"
                                                            onClick={() => handleAddPayment(layaway)}
                                                            disabled={processingId === layaway.id}
                                                        >
                                                            <CheckCircle size={18} style={{marginRight:5}} /> Confirmar
                                                        </button>
                                                        <button 
                                                            className="btn btn-secondary"
                                                            onClick={() => setActivePaymentId(null)}
                                                        >
                                                            <XCircle size={18} style={{marginRight:5}} /> Cancelar
                                                        </button>
                                                    </div>
                                                </div>
                                            )}

                                            {/* C) Acciones Generales (Entregar / Cancelar) */}
                                            {/* Solo mostramos cancelar si NO estamos abonando para evitar ruido visual, o siempre abajo */}
                                            {!isPayingThis && (
                                                <div className="layaway-main-actions">
                                                    {isReady ? (
                                                        <div style={{flex:1, display:'flex', gap:'10px', flexDirection: 'column'}}>
                                                            <div style={{textAlign:'center', color:'var(--success-color)', fontWeight:'bold', marginBottom:'5px'}}>
                                                                ¡Listo para entregar!
                                                            </div>
                                                            <button
                                                                className="btn btn-success"
                                                                style={{justifyContent:'center'}}
                                                                onClick={() => handleDeliver(layaway)}
                                                                disabled={processingId === layaway.id}
                                                            >
                                                                <ShoppingBag size={18} style={{marginRight:5}} /> Entregar Mercancía
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            className="btn btn-delete btn-sm"
                                                            onClick={() => handleCancel(layaway)}
                                                            disabled={processingId === layaway.id}
                                                            style={{border:'1px solid transparent'}} // Estilo sutil
                                                        >
                                                            <AlertTriangle size={16} style={{marginRight:5}} /> Cancelar Apartado
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}