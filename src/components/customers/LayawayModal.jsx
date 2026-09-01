import React, { useState, useEffect } from 'react';
import {
    Package, X, Calendar, DollarSign, CheckCircle, XCircle,
    AlertTriangle, ShoppingBag
} from 'lucide-react';
import { layawayRepository } from '../../services/db/layaways';
import { layawayFinancialService } from '../../services/layawayFinancialService';
import { useCaja } from '../../hooks/useCaja';
import { showConfirmModal, showMessageModal } from '../../services/utils';
import Logger from '../../services/Logger';
import { captureRefundsActorHandle } from '../../services/auth/refundsActorAuthorization';
import './LayawayModal.css';

export default function LayawayModal({
    show,
    onClose,
    customer,
    onUpdate,
    canManageRefunds = false,
    actorIdentity = null
}) {
    const [layaways, setLayaways] = useState([]);
    const [loading, setLoading] = useState(false);
    const [processingId, setProcessingId] = useState(null);

    // Estado para abonos
    const [paymentAmount, setPaymentAmount] = useState('');
    const [activePaymentId, setActivePaymentId] = useState(null); // ID del apartado que se está abonando

    const { cajaActual } = useCaja();

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
        if (processingId) return;
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
            const result = await layawayFinancialService.addPayment({
                layawayId: layaway.id,
                amount,
                customerId: customer.id
            });

            showMessageModal(result?.isFullyPaid
                ? '✅ Apartado liquidado. El dinero ya fue registrado en Caja. Confirma la entrega para reconocer la venta y calcular su ganancia bruta.'
                : '✅ Abono registrado correctamente.');
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
        // ✅ FIX: umbral alineado con addPayment ($0.01) en lugar del anterior $0.50
        if (pending > 0.01) {
            showMessageModal(`⚠️ Saldo pendiente de $${pending.toFixed(2)}. Liquídalo primero.`);
            return;
        }

        if (!(await showConfirmModal("¿Confirmar entrega de mercancía? Se registrará la venta histórica.", {
            title: 'Entregar apartado',
            confirmButtonText: 'Si, entregar',
            cancelButtonText: 'Cancelar'
        }))) return;

        setProcessingId(layaway.id);
        try {
            await layawayFinancialService.complete({ layawayId: layaway.id });
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

    const getDaysElapsed = (dateString) => {
        const start = new Date(dateString);
        const now = new Date();
        const diffTime = Math.abs(now - start);
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
    };

    if (!show || !customer) return null;

    const checkIsOverdue = (deadline) => {
        if (!deadline) return false;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const limit = new Date(deadline);
        limit.setHours(0, 0, 0, 0);
        return today > limit;
    };

    const handleCancel = async (layaway) => {
    if (!canManageRefunds || !actorIdentity) return;
    let actorHandle;
    try {
        actorHandle = captureRefundsActorHandle();
    } catch {
        showMessageModal('No tienes permiso vigente para cancelar o reembolsar apartados.', null, { type: 'error' });
        return;
    }
    const isOverdue = checkIsOverdue(layaway.deadline);
    if (!(await showConfirmModal(`¿CANCELAR apartado ${isOverdue ? 'VENCIDO' : ''}? El stock será devuelto al inventario.`, {
        title: 'Cancelar apartado',
        confirmButtonText: 'Si, cancelar apartado',
        cancelButtonText: 'Volver'
    }))) return;

    let retenerDinero = false;
    if (layaway.paidAmount > 0) {
        // Obligamos al usuario a decidir qué pasa con los fondos
        retenerDinero = await showConfirmModal(
            `💰 FONDOS RETENIDOS: $${layaway.paidAmount.toFixed(2)}\n\n` +
            `¿Deseas COBRAR este dinero como penalización?\n` +
            `[Aceptar] = La tienda se queda el dinero.\n` +
            `[Cancelar] = Reembolsar al cliente (registrará salida de caja).`,
            {
                title: 'Fondos del apartado',
                confirmButtonText: 'Cobrar penalizacion',
                cancelButtonText: 'Reembolsar'
            }
        );

        if (!retenerDinero && (!cajaActual || cajaActual.estado !== 'abierta')) {
            showMessageModal('⚠️ Necesitas una caja abierta para registrar el reembolso.');
            return;
        }
    }

    setProcessingId(layaway.id);
    try {
        await layawayFinancialService.cancel({
            layawayId: layaway.id,
            reason: 'Cancelado por usuario/vencimiento',
            retainMoney: retenerDinero,
            actorHandle
        });
        
        let msg = 'Apartado cancelado y stock restaurado.';
        if (layaway.paidAmount > 0 && !retenerDinero) {
            msg += `\n\n💵 DEVOLVER: $${layaway.paidAmount.toFixed(2)} al cliente.`;
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

    return (
        <div className="ui-modal ui-modal--high customer-layaway-modal" role="presentation">
            <div
                className="ui-modal__content ui-modal__content--lg customer-layaway-modal__content"
                role="dialog"
                aria-modal="true"
                aria-labelledby="customer-layaway-modal-title"
                aria-busy={loading}
            >
                
                {/* Header */}
                <div className="ui-modal__header customer-layaway-modal__header">
                    <h2 id="customer-layaway-modal-title" className="ui-modal__title customer-layaway-modal__title">
                        <Package className="customer-layaway-modal__title-icon" size={22} aria-hidden="true" />
                        <span className="customer-layaway-modal__title-copy">
                            <span className="customer-layaway-modal__title-label">Apartados</span>
                            <span className="customer-layaway-modal__title-customer">{customer.name}</span>
                        </span>
                    </h2>
                    <button
                        type="button"
                        className="ui-icon-button customer-layaway-modal__close"
                        onClick={onClose}
                        aria-label="Cerrar apartados"
                    >
                        <X size={20} aria-hidden="true" />
                    </button>
                </div>

                {/* Body */}
                <div className="ui-modal__body customer-layaway-modal__body">
                    {loading ? (
                        <div className="customer-layaway-empty-state customer-layaway-empty-state--loading" role="status" aria-live="polite">
                            <span className="customer-layaway-modal__spinner" aria-hidden="true"></span>
                            <p className="customer-layaway-empty-state__copy">Cargando...</p>
                        </div>
                    ) : layaways.length === 0 ? (
                        <div className="customer-layaway-empty-state" role="status">
                            <div className="customer-layaway-empty-state__icon" aria-hidden="true">
                                <Package size={28} strokeWidth={1.75} />
                            </div>
                            <div className="customer-layaway-empty-state__content">
                                <h3 className="customer-layaway-empty-state__title">Sin apartados</h3>
                                <p className="customer-layaway-empty-state__copy">Este cliente no tiene apartados activos.</p>
                            </div>
                        </div>
                    ) : (
                        <div className="customer-layaway-list">
                            {layaways.map(layaway => {
                                const pending = layaway.totalAmount - (layaway.paidAmount || 0);
                                const progress = Math.min((layaway.paidAmount / layaway.totalAmount) * 100, 100);
                                // ✅ FIX: umbral de isReady alineado a $0.01 para coincidir con addPayment y handleDeliver
                                const isReady = pending <= 0.01 || layaway.status === 'ready';
                                const daysElapsed = getDaysElapsed(layaway.createdAt);
                                const isOverdue = checkIsOverdue(layaway.deadline);
                                const isPayingThis = activePaymentId === layaway.id;
                                const paymentInputId = `customer-layaway-payment-${layaway.id}`;

                                return (
                                    <div key={layaway.id} className="customer-layaway-card">
                                        
                                        {/* 1. Header de Tarjeta */}
                                        <div className="customer-layaway-card__header">
    <div className="customer-layaway-card__meta">
        <div className="customer-layaway-card__date">
            <Calendar size={16} aria-hidden="true" />
            {new Date(layaway.createdAt).toLocaleDateString()}
        </div>
        <span className="customer-layaway-card__deadline">
            Límite: {layaway.deadline ? new Date(layaway.deadline).toLocaleDateString() : 'Sin definir'}
        </span>
    </div>
    <div className={`customer-layaway-status ${isReady ? 'customer-layaway-status--ready' : (isOverdue ? 'customer-layaway-status--overdue' : 'customer-layaway-status--pending')}`}>
        {isReady ? 'Listo' : (isOverdue ? 'Vencido' : 'Pendiente')}
    </div>
</div>

                                        {/* Banner de alerta para apartados vencidos */}
                                        {isOverdue && !isReady && (
                                            <div className="customer-layaway-card__overdue-alert">
                                                <AlertTriangle
                                                    className="customer-layaway-card__overdue-icon"
                                                    size={18}
                                                    aria-hidden="true"
                                                />
                                                <div>
                                                    <strong>Apartado vencido.</strong>{' '}
                                                    Venció el {layaway.deadline ? new Date(layaway.deadline).toLocaleDateString() : 'fecha desconocida'}.
                                                    {' '}Los abonos están bloqueados. Cancela el apartado para devolver el stock al inventario.
                                                </div>
                                            </div>
                                        )}

                                        {/* 2. Productos (Diseño Híbrido) */}
                                        <div className="customer-layaway-card__products">
                                            {/* Versión Escritorio */}
                                            <table className="customer-layaway-card__table">
                                                <thead>
                                                    <tr>
                                                        <th>Producto</th>
                                                        <th className="customer-layaway-card__quantity-heading">Cant.</th>
                                                        <th className="customer-layaway-card__total-heading">Total</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {layaway.items.map((item, idx) => (
                                                        <tr key={idx}>
                                                            <td>
                                                                {item.name}
                                                                {item.variantName && <small className="customer-layaway-card__variant">{item.variantName}</small>}
                                                            </td>
                                                            <td className="customer-layaway-card__quantity">x{item.quantity}</td>
                                                            <td className="customer-layaway-card__total">${(item.price * item.quantity).toFixed(2)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>

                                            {/* Versión Móvil */}
                                            <div className="customer-layaway-card__mobile-products">
                                                {layaway.items.map((item, idx) => (
                                                    <div key={idx} className="customer-layaway-card__mobile-item">
                                                        <div className="customer-layaway-card__item-info">
                                                            <span className="customer-layaway-card__item-name">{item.name} {item.variantName ? `(${item.variantName})` : ''}</span>
                                                            <span className="customer-layaway-card__item-quantity">{item.quantity} ud. a ${item.price}</span>
                                                        </div>
                                                        <span className="customer-layaway-card__item-total">${(item.price * item.quantity).toFixed(2)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {/* 3. Finanzas (Grid) */}
                                        <div className="customer-layaway-card__financial">
                                            <div className="customer-layaway-financial-grid">
                                                <div className="customer-layaway-financial-block">
                                                    <span className="customer-layaway-financial-label">Total</span>
                                                    <span className="customer-layaway-financial-value customer-layaway-financial-value--total">${layaway.totalAmount.toFixed(2)}</span>
                                                </div>
                                                <div className="customer-layaway-financial-block">
                                                    <span className="customer-layaway-financial-label">Abonado</span>
                                                    <span className="customer-layaway-financial-value customer-layaway-financial-value--paid">${layaway.paidAmount.toFixed(2)}</span>
                                                </div>
                                                <div className="customer-layaway-financial-block">
                                                    <span className="customer-layaway-financial-label">Resta</span>
                                                    <span className="customer-layaway-financial-value customer-layaway-financial-value--debt">${pending.toFixed(2)}</span>
                                                </div>
                                            </div>
                                            <div className="customer-layaway-progress">
                                                <div 
                                                    className={`customer-layaway-progress__fill ${isReady ? 'customer-layaway-progress__fill--ready' : 'customer-layaway-progress__fill--pending'}`}
                                                    style={{ width: `${progress}%` }}
                                                ></div>
                                            </div>
                                        </div>

                                        {/* 4. Footer de Acciones */}
                                        <div className="customer-layaway-card__footer">
                                            
                                            {/* A) Modo Normal: Botón de Abonar grande y Botones de gestión */}
                                            {!isPayingThis && !isReady && (
    <button 
        className="ui-button ui-button--primary ui-button--block customer-layaway-card__start-payment"
        type="button"
        onClick={() => {
            setActivePaymentId(layaway.id);
            setPaymentAmount('');
        }}
        disabled={isOverdue} // <-- BLOQUEO
    >
        <DollarSign size={20} aria-hidden="true" /> {isOverdue ? 'Abonos Bloqueados (Vencido)' : 'Registrar Nuevo Abono'}
    </button>
)}

                                            {/* B) Modo Abono: Formulario Expandido */}
                                            {isPayingThis && (
                                                <div className="customer-layaway-payment">
                                                    <label
                                                        htmlFor={paymentInputId}
                                                        className="customer-layaway-payment__label"
                                                    >
                                                        ¿Cuánto desea abonar?
                                                    </label>
                                                    <div className="customer-layaway-payment__input-row">
                                                        <span className="customer-layaway-payment__currency">$</span>
                                                        <input 
                                                            id={paymentInputId}
                                                            type="number" 
                                                            className="customer-layaway-payment__input"
                                                            placeholder="0.00"
                                                            autoFocus
                                                            value={paymentAmount}
                                                            onChange={(e) => setPaymentAmount(e.target.value)}
                                                            onKeyDown={(e) => e.key === 'Enter' && handleAddPayment(layaway)}
                                                        />
                                                    </div>
                                                    <div className="customer-layaway-payment__actions">
                                                        <button 
                                                            className="ui-button ui-button--primary customer-layaway-payment__action"
                                                            type="button"
                                                            onClick={() => handleAddPayment(layaway)}
                                                            disabled={processingId === layaway.id}
                                                        >
                                                            <CheckCircle size={18} aria-hidden="true" /> Confirmar
                                                        </button>
                                                        <button 
                                                            className="ui-button ui-button--secondary customer-layaway-payment__action"
                                                            type="button"
                                                            onClick={() => setActivePaymentId(null)}
                                                        >
                                                            <XCircle size={18} aria-hidden="true" /> Cancelar
                                                        </button>
                                                    </div>
                                                </div>
                                            )}

                                            {/* C) Acciones Generales (Entregar / Cancelar) */}
                                            {/* Solo mostramos cancelar si NO estamos abonando para evitar ruido visual, o siempre abajo */}
                                            {!isPayingThis && (
                                                <div className="customer-layaway-card__actions">
                                                    {isReady ? (
                                                        <div className="customer-layaway-card__ready-actions">
                                                            <div className="customer-layaway-card__ready-message">
                                                                Apartado liquidado. Falta confirmar entrega para reconocer la venta.
                                                            </div>
                                                            <button
                                                                className="ui-button ui-button--success ui-button--block customer-layaway-card__deliver"
                                                                type="button"
                                                                onClick={() => handleDeliver(layaway)}
                                                                disabled={processingId === layaway.id}
                                                            >
                                                                <ShoppingBag size={18} aria-hidden="true" /> Confirmar entrega y reconocer venta
                                                            </button>
                                                        </div>
                                                    ) : canManageRefunds ? (
                                                        <button
                                                            className="ui-button ui-button--danger ui-button--sm customer-layaway-card__cancel"
                                                            type="button"
                                                            onClick={() => handleCancel(layaway)}
                                                            disabled={processingId === layaway.id}
                                                        >
                                                            <AlertTriangle size={16} aria-hidden="true" /> Cancelar Apartado
                                                        </button>
                                                    ) : null}
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
