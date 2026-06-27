// src/hooks/pos/usePosCheckout.js
import { useCallback, useRef } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { broadcastDBChange } from '../../store/useProductStore';
import { showMessageModal } from '../../services/utils';
import { useActiveOrders } from './useActiveOrders';
import { Money } from '../../utils/moneyMath';
import {
    isCloudSalesCashierEnabled,
    isCloudSalesCreditEnabled
} from '../../services/sync/syncConstants';

const CLOUD_TURN_REQUIRED_PAYMENT_METHODS = new Set([
    'cash',
    'card',
    'transfer',
    'credit',
    'mixed'
]);

const shouldRequireOpenCashSessionForCloudSale = (licenseDetails) => Boolean(
    licenseDetails?.valid &&
    (
        isCloudSalesCashierEnabled(licenseDetails) ||
        isCloudSalesCreditEnabled(licenseDetails)
    )
);

const normalizePaymentMethod = (method) => {
    const raw = String(method || '').trim().toLowerCase();

    if (['cash', 'efectivo'].includes(raw)) return 'cash';

    if ([
        'card',
        'tarjeta',
        'tarjeta_credito',
        'tarjeta_debito',
        'debit',
        'credit_card',
        'debit_card'
    ].includes(raw)) {
        return 'card';
    }

    if ([
        'transfer',
        'transferencia',
        'spei',
        'bank_transfer'
    ].includes(raw)) {
        return 'transfer';
    }

    if (['mixed', 'mixto'].includes(raw)) return 'mixed';

    if ([
        'fiado',
        'credit',
        'credito',
        'crédito',
        'customer_credit',
        'mixed_credit',
        'partial_credit'
    ].includes(raw)) {
        return 'credit';
    }

    return raw;
};

/**
 * Hook para manejar el flujo completo de checkout del POS.
 * Encapsula la lógica de inicio de pago, procesamiento de orden y caja rápida.
 *
 * ## Patrón Snapshot (Fase 2)
 * Al iniciar el checkout, se captura una **copia profunda e inmutable** del estado de
 * la orden en ese instante (`checkoutSnapshot`). El motor de pagos (`processSale`)
 * opera exclusivamente sobre este snapshot, eliminando cualquier condición de carrera
 * derivada de cambios reactivos en el carrito durante la asincronía del pago.
 *
 * ## Ciclo de vida del Snapshot
 * CREADO en: handleInitiateCheckout (después de adquirir el lock)
 * DESTRUIDO en:
 *   - handlePaymentModalClose  → usuario cierra el modal explícitamente (click X)
 *   - handleProcessOrder       → antes de llamar a processSale (éxito o error definitivo)
 *   - RESTAURADO temporalmente → en STOCK_WARNING para permitir el reintento con forceSale
 *
 * ⚠️ IMPORTANTE: El rollback NO usa useEffect. Esto es intencional.
 * useEffect + modal.activeModal causaba que el snapshot se destruyera en flujos legítimos:
 *   - Flujo efectivo/caja: closeModal('payment') → openModal('quickCaja') → snapshot perdido
 *   - Flujo prescripción: openModal('prescription') → activeModal ≠ 'payment' → snapshot perdido
 *   - Flujo STOCK_WARNING: el reintento con forceSale fallaba por snapshot nulo
 *
 * @param {Object} deps - Dependencias externas
 * @param {Object} deps.pos - Estado y acciones de usePosPage
 * @param {Object} deps.posSearch - Estado y acciones de usePosSearch
 * @param {Object} deps.modal - Funciones de openModal/closeModal
 * @param {Object} deps.mobileCart - Funciones de openCart/closeCart
 * @param {Object} deps.prescription - Estado de prescripciones
 * @param {Object} deps.features - Feature flags
 * @param {function} deps.fetchActiveTablesCount - Actualiza conteo de mesas
 * @returns {{
 *   handleInitiateCheckout: () => Promise<void>,
 *   handleProcessOrder: (paymentData: Object, forceSale?: boolean) => Promise<void>,
 *   handlePaymentModalClose: () => void,
 *   handleQuickCajaSubmit: (monto: string) => Promise<void>
 * }}
 */
export function usePosCheckout({
    pos,
    posSearch,
    modal,
    mobileCart,
    prescription,
    features,
    fetchActiveTablesCount
}) {
    const verifySessionIntegrity = pos.verifySessionIntegrity;
    const abrirCaja = pos.abrirCaja;

    /**
     * Snapshot inmutable de la orden al momento de iniciar el cobro.
     * Null cuando no hay un proceso de cobro activo.
     *
     * @type {React.MutableRefObject<{
     *   orderId: string,
     *   order: Array,
     *   total: number,
     *   tableData: any
     * } | null>}
     */
    const checkoutSnapshotRef = useRef(null);

    // ── Cierre explícito del modal de pagos ─────────────────────────
    /**
     * Callback para el botón de cierre (X) del PaymentModal.
     * Es la ÚNICA vía de rollback pasivo: solo se llama cuando el usuario
     * cancela el pago manualmente, no cuando el código lo cierra programáticamente.
     *
     * Diferencia clave vs useEffect:
     *   - useEffect reacciona a CUALQUIER cambio de activeModal, incluyendo los
     *     cierres programáticos de handleProcessOrder (flujo efectivo, errores, etc.)
     *   - Este callback solo se dispara cuando el usuario hace clic en X/backdrop.
     */
    const handlePaymentModalClose = useCallback(() => {
        if (checkoutSnapshotRef.current !== null) {
            const snapshot = checkoutSnapshotRef.current;
            checkoutSnapshotRef.current = null; // Destruir antes del async

            useActiveOrders.getState().unlockOrder(snapshot.orderId).catch((err) => {
                console.error('[usePosCheckout] Error en rollback al cerrar modal de pago:', err);
            });
        }
        modal.closeModal('payment');
    }, [modal]);

    // ── Iniciar checkout ───────────────────────────────────────────
    const handleInitiateCheckout = useCallback(async () => {
        const licenseDetails = useAppStore.getState().licenseDetails;
        if (!licenseDetails || !licenseDetails.valid) {
            showMessageModal('⚠️ Error de Seguridad: Licencia no válida.');
            return;
        }

        const activeOrdersState = useActiveOrders.getState();
        const pendingInventoryCount = (
            activeOrdersState.pendingInventoryResolutions?.get(pos.activeOrderId) || 0
        );

        if (pendingInventoryCount > 0) {
            showMessageModal(
                'Espera a que termine la asignación de inventario antes de cobrar.',
                null,
                { type: 'warning' }
            );
            return;
        }

        const itemsToProcess = pos.order.filter(item => item.quantity && item.quantity > 0);
        if (itemsToProcess.length === 0) {
            showMessageModal('El pedido está vacío.');
            return;
        }

        mobileCart.closeCart();

        const deepClone = (value) => {
            if (typeof structuredClone === 'function') {
                return structuredClone(value);
            }
            return JSON.parse(JSON.stringify(value));
        };

        // ── FASE 2: Adquirir Lock atómico antes de abrir el modal ──
        const lockResult = await useActiveOrders.getState().lockOrderForCheckout(pos.activeOrderId);

        if (!lockResult.success) {
            showMessageModal(
                `⚠️ No se puede iniciar el cobro: ${lockResult.reason}`,
                null,
                { type: 'warning' }
            );
            return;
        }

        const lockedState = useActiveOrders.getState();
        const lockedOrder = lockedState.activeOrders.get(pos.activeOrderId);
        const pendingAfterLock = (
            lockedState.pendingInventoryResolutions?.get(pos.activeOrderId) || 0
        );

        if (pendingAfterLock > 0 || !lockedOrder) {
            await lockedState.unlockOrder(pos.activeOrderId);
            showMessageModal(
                pendingAfterLock > 0
                    ? 'Espera a que termine la asignación de inventario antes de cobrar.'
                    : 'No se encontró la orden activa para iniciar el cobro.',
                null,
                { type: 'warning' }
            );
            return;
        }

        const lockedItemsToProcess = lockedOrder.items.filter(
            item => item.quantity && item.quantity > 0
        );

        if (lockedItemsToProcess.length === 0) {
            await lockedState.unlockOrder(pos.activeOrderId);
            showMessageModal('El pedido está vacío.');
            return;
        }

        // Construir el snapshot después del lock evita capturar una orden obsoleta.
        const checkoutSnapshot = {
            orderId: pos.activeOrderId,
            order: deepClone(lockedOrder.items),
            total: Number(lockedOrder.total),
            tableData: deepClone(lockedOrder.tableData ?? null),
        };

        // Persistir snapshot en ref (sin re-render)
        checkoutSnapshotRef.current = checkoutSnapshot;

        // ── Flujo de prescripción o pago directo ───────────────────
        // El snapshot sobrevive independientemente del modal que se abra.
        // No hay useEffect observando activeModal, así que openModal('prescription')
        // NO destruye el snapshot.
        const itemsRequiring = features?.hasLabFields
            ? lockedItemsToProcess.filter(item =>
                item.requiresPrescription ||
                (item.prescriptionType && item.prescriptionType !== 'otc')
            )
            : [];

        if (itemsRequiring.length > 0) {
            prescription.setPrescriptionItems(itemsRequiring);
            prescription.setTempPrescriptionData(null);
            modal.openModal('prescription');
        } else {
            prescription.setTempPrescriptionData(null);
            modal.openModal('payment');
        }
    }, [
        pos.order,
        pos.activeOrderId,
        features?.hasLabFields,
        mobileCart,
        modal,
        prescription
    ]);

    // ── Procesar orden ─────────────────────────────────────────────
    /**
     * Procesa el pago usando exclusivamente el `checkoutSnapshot`.
     * Ninguna referencia a `pos.order`, `pos.total` ni `pos.activeOrderId` en vivo.
     *
     * GESTIÓN DEL SNAPSHOT:
     * - Se captura en variable local al inicio (inmune a cambios del ref posterior)
     * - Se destruye del ref ANTES de llamar a processSale para evitar doble-unlock
     *   si handlePaymentModalClose se llama de alguna forma durante el async
     * - Se RESTAURA al ref en STOCK_WARNING para permitir el reintento con forceSale=true
     *
     * @param {Object} paymentData - Datos del método de pago
     * @param {boolean} [forceSale=false] - Omitir validación de stock
     */
    const handleProcessOrder = useCallback(async (paymentData, forceSale = false) => {
        // Capturar el snapshot en variable local INMEDIATAMENTE.
        // A partir de este punto, `snapshot` es una referencia estable e independiente
        // del ref, inmune a cualquier modificación externa del ref.
        const snapshot = checkoutSnapshotRef.current;

        if (!snapshot) {
            // Situación anómala: modal abierto sin pasar por handleInitiateCheckout.
            // Esto puede ocurrir si el modal se abre desde un path alternativo no previsto.
            console.error('[usePosCheckout] handleProcessOrder llamado sin snapshot activo.');
            showMessageModal('⚠️ Error interno: cierra el modal y vuelve a intentar el cobro.');
            modal.closeModal('payment');
            return;
        }

        const isSessionValid = await verifySessionIntegrity();
        if (!isSessionValid) {
            showMessageModal('Sesion invalida o licencia expirada. El sistema se recargará.', () => {
                window.location.reload();
            });
            return;
        }

        if (paymentData.paymentMethod === 'fiado') {
            if (!paymentData.dueDate) {
                showMessageModal('⚠️ Fecha de vencimiento es requerida para ventas a crédito.');
                checkoutSnapshotRef.current = null;
                modal.closeModal('payment');
                return;
            }
            const todayStr = new Date().toISOString().split('T')[0];
            const dueDateStr = paymentData.dueDate.split('T')[0];
            if (dueDateStr < todayStr) {
                showMessageModal('⚠️ La fecha de vencimiento no puede ser en el pasado.');
                checkoutSnapshotRef.current = null;
                modal.closeModal('payment');
                return;
            }
        }

        // ── Redirección a Caja Rápida ──────────────────────────────
        // El snapshot NO se destruye aquí. El flujo esperado es:
        //   closeModal('payment') → openModal('quickCaja') → handleQuickCajaSubmit
        //   → openModal('payment') [snapshot aún vivo] → handleProcessOrder [snapshot válido]
        const paymentMethod = normalizePaymentMethod(paymentData.paymentMethod);

        const initialPaymentMethod = normalizePaymentMethod(
            paymentData.initialPaymentMethod ||
            paymentData.abonoPaymentMethod ||
            paymentData.creditPaymentMethod ||
            paymentData.partialPaymentMethod ||
            'efectivo'
        );

        const hasInitialCreditPayment = (
            paymentMethod === 'credit' &&
            Money.init(paymentData.amountPaid || 0).gt(0)
        );

        const hasCashComponent =
            paymentMethod === 'cash' ||
            (
                hasInitialCreditPayment &&
                initialPaymentMethod === 'cash'
            );

        const licenseDetails = useAppStore.getState().licenseDetails;
        const cloudSalesTurnRequired = shouldRequireOpenCashSessionForCloudSale(licenseDetails);
        const requiresOpenCashSession = cloudSalesTurnRequired
            ? CLOUD_TURN_REQUIRED_PAYMENT_METHODS.has(paymentMethod)
            : hasCashComponent;

        if (requiresOpenCashSession && (!pos.cajaActual || pos.cajaActual.estado !== 'abierta')) {
            modal.closeModal('payment'); // Cierre programático, snapshot sobrevive
            modal.openModal('quickCaja');
            return;
        }

        // ── Comprometer la transacción ─────────────────────────────
        // Destruir el ref ANTES del await para que handlePaymentModalClose
        // no haga un unlock duplicado si se llamara durante la asincronía.
        checkoutSnapshotRef.current = null;

        let isSuccess = false;
        let isStockWarning = false;

        try {
            modal.closeModal('payment');

            // ── FASE 2: Motor de pagos aislado del estado reactivo ─
            // processSale recibe exclusivamente datos del snapshot.
            const { processSale } = await import('../../services/salesService');
            const result = await processSale({
                order: snapshot.order,           // ← snapshot, NO pos.order
                paymentData,
                total: snapshot.total,           // ← snapshot, NO pos.total
                allProducts: posSearch.menuVisual,
                features,
                companyName: useAppStore.getState().companyProfile?.name || 'Tu Negocio',
                tempPrescriptionData: prescription.tempPrescriptionData,
                ignoreStock: forceSale,
                activeOrderId: snapshot.orderId, // ← snapshot, NO pos.activeOrderId
            });

            if (result.success) {
                isSuccess = true;
                // 1. PRIMERO: Cerrar la orden en activeOrders con el ID del snapshot.
                //    Fase 3: Se usa removeOrder para destrucción total de la orden en el gestor.
                try {
                    await useActiveOrders.getState().removeOrder(snapshot.orderId);
                } catch (closeErr) {
                    console.error('[usePosCheckout] Error eliminando orden en activeOrders:', closeErr);
                }

                // 2. DESPUÉS: Limpiar sesión local de UI.
                //    Se invoca DESPUÉS de que la orden dejó de existir en el gestor.
                prescription.setTempPrescriptionData(null);
                mobileCart.closeCart();

                showMessageModal('✅ ¡Venta registrada correctamente!');
                broadcastDBChange({ action: 'sale-completed', saleId: result.saleId });
                await posSearch.refreshOutOfStock();
                await fetchActiveTablesCount();

            } else if (result.errorType === 'RACE_CONDITION') {
                showMessageModal('⚠️ El sistema está muy ocupado. Por favor intenta cobrar de nuevo.');
                await posSearch.refreshOutOfStock();

            } else if (result.errorType === 'STOCK_WARNING') {
                isStockWarning = true;
                // Stock insuficiente pero el cajero puede forzar la venta.
                // RESTAURAR el snapshot al ref para el reintento.
                checkoutSnapshotRef.current = snapshot;
                showMessageModal(
                    result.message,
                    async () => {
                        // Como hubo un rollback en el finally, volvemos a obtener el lock antes de reintentar
                        const lockResult = await useActiveOrders.getState().lockOrderForCheckout(snapshot.orderId);
                        if (lockResult.success) {
                            handleProcessOrder(paymentData, true);
                        } else {
                            showMessageModal(`⚠️ No se puede forzar el cobro: ${lockResult.reason}`, null, { type: 'warning' });
                        }
                    },
                    {
                        confirmButtonText: 'Sí, Vender Igual',
                        type: 'warning',
                    }
                );

            } else {
                showMessageModal(`Error: ${result.message}`, null, { type: 'error' });
            }

        } catch (error) {
            console.error('[usePosCheckout] Error crítico en UI:', error);
            showMessageModal(`Error inesperado: ${error.message}`);
        } finally {
            // ── FASE 3: Orquestación Final y Rollbacks ──
            // Si la venta NO fue exitosa (falla, cancelación, stock, o catch),
            // ejecutamos un rollback INMEDIATO para devolver la orden a DRAFT.
            if (!isSuccess) {
                await useActiveOrders.getState().unlockOrder(snapshot.orderId).catch((err) => {
                    console.error('[usePosCheckout] Error en rollback en finally:', err);
                });

                // Destruir el snapshot del ref solo si no fue un stock warning
                // (el stock warning lo necesita para el posible forceSale).
                if (!isStockWarning) {
                    checkoutSnapshotRef.current = null;
                }
            }
        }
    }, [
        verifySessionIntegrity,
        pos.cajaActual,
        posSearch,
        features,
        prescription,
        modal,
        mobileCart,
        fetchActiveTablesCount
        // NOTA: pos.order, pos.total y pos.activeOrderId están INTENCIONALMENTE AUSENTES.
        // El motor de pagos lee esos valores del snapshot capturado en variable local,
        // no del estado reactivo de Zustand.
    ]);

    // ── Caja rápida ────────────────────────────────────────────────
    // Cuando la caja se abre exitosamente, reabrimos el modal de pagos.
    // El checkoutSnapshotRef sigue vivo desde handleInitiateCheckout
    // porque el flujo efectivo/caja NO lo destruye.
    const handleQuickCajaSubmit = useCallback(async (openingData) => {
        const success = await abrirCaja(openingData);
        if (success) {
            modal.closeModal('quickCaja');
            modal.openModal('payment'); // ← snapshot aún válido en checkoutSnapshotRef ✓
        }
        return success;
    }, [abrirCaja, modal]);

    return {
        handleInitiateCheckout,
        handleProcessOrder,
        handlePaymentModalClose, // ← Exportado para PosModals: onClose del PaymentModal
        handleQuickCajaSubmit
    };
}