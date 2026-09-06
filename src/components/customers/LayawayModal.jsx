import { useState, useEffect, useRef, useCallback } from 'react';
import {
    Package, X, Calendar, DollarSign, CheckCircle, XCircle,
    AlertTriangle, ShoppingBag
} from 'lucide-react';
import { layawayRepository } from '../../services/db/layaways';
import { layawayFinancialService } from '../../services/layawayFinancialService';
import { reportsRepository } from '../../services/reports/reportsRepository';
import { useCaja } from '../../hooks/useCaja';
import { useActorRuntimeSnapshot } from '../../services/auth/useActorRuntimeSnapshot';
import { getSalesFinalHistoryScope } from '../../services/auth/salesPermissionPolicy';
import { showConfirmModal, showMessageModal } from '../../services/utils';
import Logger from '../../services/Logger';
import { captureRefundsActorHandle } from '../../services/auth/refundsActorAuthorization';
import {
    buildHistoricalLayawayFolios,
    isActionableLayaway,
    isTerminalLayaway,
    normalizeLayawayStatus,
    splitLayawaysForDisplay
} from './layawayHistory';
import './LayawayModal.css';

const CALENDAR_DATE_PATTERN = /^([0-9]{4})-([0-9]{2})-([0-9]{2})(?:T|$)/;

const getCalendarDateParts = (value) => {
    if (value === null || value === undefined) return null;
    const match = String(value).trim().match(CALENDAR_DATE_PATTERN);
    if (!match) return null;

    const [, yearText, monthText, dayText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const probe = new Date(0);
    probe.setUTCFullYear(year, month - 1, day);
    probe.setUTCHours(0, 0, 0, 0);

    return probe.getUTCFullYear() === year
        && probe.getUTCMonth() === month - 1
        && probe.getUTCDate() === day
        ? { year, month, day }
        : null;
};

const calendarDateKey = (parts) => parts && (parts.year * 10000 + parts.month * 100 + parts.day);

const formatCalendarDate = (value) => {
    const parts = getCalendarDateParts(value);
    if (!parts) return 'Fecha inválida';
    const date = new Date(0);
    date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
    date.setUTCHours(0, 0, 0, 0);
    return date.toLocaleDateString(undefined, { timeZone: 'UTC' });
};

export default function LayawayModal({
    show,
    onClose,
    customer,
    onUpdate,
    canManageRefunds = false,
    actorIdentity = null
}) {
    const [layaways, setLayaways] = useState([]);
    const [historicalFolios, setHistoricalFolios] = useState({});
    const [loading, setLoading] = useState(false);
    const [processingId, setProcessingId] = useState(null);

    // Estado para abonos
    const [paymentAmount, setPaymentAmount] = useState('');
    const [activePaymentId, setActivePaymentId] = useState(null); // ID del apartado que se está abonando

    const { cajaActual } = useCaja();
    const actorRuntime = useActorRuntimeSnapshot();
    const salesHistoryScope = getSalesFinalHistoryScope(actorRuntime);
    const loadVersionRef = useRef(0);

    const loadLayaways = useCallback(async (loadVersion = loadVersionRef.current) => {
        setLoading(true);
        try {
            const allLayaways = await layawayRepository.getByCustomer(customer.id, false);
            const { history } = splitLayawaysForDisplay(allLayaways);
            let folios = {};

            // The report RPC is an existing, server-authorized read boundary.
            // It is invoked while loading the modal, never by a historical card
            // render, and only receives the broader scope for actors the server
            // also recognizes as audit-capable.
            if (history.some((layaway) => normalizeLayawayStatus(layaway) === 'completed' && (layaway.conversionSaleId || layaway.conversion_sale_id))) {
                try {
                    const salesHistory = await reportsRepository.getSalesFinalHistory({
                        scope: salesHistoryScope,
                        customerId: customer.id,
                        limit: 500,
                        offset: 0
                    });
                    folios = buildHistoricalLayawayFolios({
                        layaways: history,
                        sales: salesHistory?.sales || salesHistory?.rows || []
                    });
                } catch (error) {
                    // A failed optional reference lookup must not hide the
                    // terminal layaway or cause a fallback financial action.
                    Logger.warn('No se pudo cargar el folio de venta del historial de apartados', error);
                }
            }

            if (loadVersionRef.current !== loadVersion) return;
            setLayaways(allLayaways);
            setHistoricalFolios(folios);
        } catch (error) {
            if (loadVersionRef.current !== loadVersion) return;
            Logger.error("Error cargando apartados", error);
            showMessageModal("Error al cargar los apartados del cliente.");
        } finally {
            if (loadVersionRef.current === loadVersion) setLoading(false);
        }
    }, [customer, salesHistoryScope]);

    useEffect(() => {
        const loadVersion = ++loadVersionRef.current;
        if (show && customer) {
            loadLayaways(loadVersion);
        } else {
            setLayaways([]);
            setHistoricalFolios({});
            setPaymentAmount('');
            setActivePaymentId(null);
        }
        return () => {
            if (loadVersionRef.current === loadVersion) loadVersionRef.current += 1;
        };
    }, [show, customer, loadLayaways]);

    const handleAddPayment = async (layaway) => {
        if (processingId) return;
        if (!isActionableLayaway(layaway)) {
            showMessageModal('Este apartado ya es histórico y no acepta más abonos.', null, { type: 'warning' });
            return;
        }
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
                customerId: customer.id,
                expectedCashSessionId: cajaActual?.id || null
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
        if (!isActionableLayaway(layaway)) {
            showMessageModal('Este apartado ya fue finalizado y es de solo lectura.', null, { type: 'warning' });
            return;
        }
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

    if (!show || !customer) return null;

    const checkIsOverdue = (deadline) => {
        const deadlineParts = getCalendarDateParts(deadline);
        if (!deadlineParts) return false;
        const today = new Date();
        const todayParts = {
            year: today.getFullYear(),
            month: today.getMonth() + 1,
            day: today.getDate()
        };
        return calendarDateKey(todayParts) > calendarDateKey(deadlineParts);
    };

    const handleCancel = async (layaway) => {
    if (!isActionableLayaway(layaway)) {
        showMessageModal('Este apartado ya es histórico y no puede cancelarse.', null, { type: 'warning' });
        return;
    }
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
            actorHandle,
            expectedCashSessionId: cajaActual?.id || null
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

    const layawaySections = splitLayawaysForDisplay(layaways);
    const visibleSections = [
        {
            key: 'active',
            title: 'Apartados activos',
            description: 'Apartados que aún admiten operaciones según su estado.',
            layaways: layawaySections.active,
            historical: false
        },
        {
            key: 'history',
            title: 'Historial de apartados',
            description: 'Apartados finalizados. Esta sección es de solo lectura.',
            layaways: layawaySections.history,
            historical: true
        }
    ].filter((section) => section.layaways.length > 0);

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
                    ) : visibleSections.length === 0 ? (
                        <div className="customer-layaway-empty-state" role="status">
                            <div className="customer-layaway-empty-state__icon" aria-hidden="true">
                                <Package size={28} strokeWidth={1.75} />
                            </div>
                            <div className="customer-layaway-empty-state__content">
                                <h3 className="customer-layaway-empty-state__title">Sin apartados</h3>
                                <p className="customer-layaway-empty-state__copy">Este cliente no tiene apartados registrados.</p>
                            </div>
                        </div>
                    ) : (
                        <div className="customer-layaway-list">
                            {visibleSections.map((section) => (
                                <section
                                    key={section.key}
                                    className={`customer-layaway-section ${section.historical ? 'customer-layaway-section--history' : 'customer-layaway-section--active'}`}
                                    aria-labelledby={`customer-layaway-section-${section.key}`}
                                >
                                    <div className="customer-layaway-section__header">
                                        <h3 id={`customer-layaway-section-${section.key}`} className="customer-layaway-section__title">{section.title}</h3>
                                        <p className="customer-layaway-section__description">{section.description}</p>
                                    </div>
                                    {section.layaways.map(layaway => {
                                const status = normalizeLayawayStatus(layaway);
                                const isHistorical = section.historical || isTerminalLayaway(layaway);
                                const isCompleted = status === 'completed';
                                const pending = layaway.totalAmount - (layaway.paidAmount || 0);
                                const progress = Math.min((layaway.paidAmount / layaway.totalAmount) * 100, 100);
                                // ✅ FIX: umbral de isReady alineado a $0.01 para coincidir con addPayment y handleDeliver
                                const isReady = !isHistorical && (pending <= 0.01 || status === 'ready');
                                const isOverdue = !isHistorical && checkIsOverdue(layaway.deadline);
                                const isPayingThis = activePaymentId === layaway.id;
                                const paymentInputId = `customer-layaway-payment-${layaway.id}`;
                                const completionFolio = historicalFolios[layaway.id] || null;

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
            Límite: {layaway.deadline ? formatCalendarDate(layaway.deadline) : 'Sin definir'}
        </span>
    </div>
    <div className={`customer-layaway-status ${isCompleted ? 'customer-layaway-status--completed' : (status === 'cancelled' ? 'customer-layaway-status--cancelled' : (isReady ? 'customer-layaway-status--ready' : (isOverdue ? 'customer-layaway-status--overdue' : 'customer-layaway-status--pending')))}`}>
        {isCompleted ? 'Completado' : (status === 'cancelled' ? 'Cancelado' : (isReady ? 'Listo' : (isOverdue ? 'Vencido' : 'Pendiente')))}
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
                                                    Venció el {layaway.deadline ? formatCalendarDate(layaway.deadline) : 'fecha desconocida'}.
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

                                        {isHistorical && (
                                            <div className="customer-layaway-history-details" aria-label="Detalles históricos del apartado">
                                                <span>Cliente: {layaway.customerName || customer.name}</span>
                                                <span>Finalizado: {layaway.deliveredAt ? new Date(layaway.deliveredAt).toLocaleDateString() : (layaway.updatedAt ? new Date(layaway.updatedAt).toLocaleDateString() : 'Sin fecha disponible')}</span>
                                                {isCompleted && (
                                                    <>
                                                        <span>Venta vinculada</span>
                                                        <span>Folio: {completionFolio || 'No disponible'}</span>
                                                    </>
                                                )}
                                            </div>
                                        )}

                                        {/* 4. Footer de Acciones */}
                                        {!isHistorical && (
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
                                        )}
                                    </div>
                                );
                            })}
                                </section>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
