// src/hooks/pos/usePosCheckout.js
import { useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { broadcastDBChange } from '../../store/useProductStore';
import { showConfirmModal, showMessageModal } from '../../services/utils';
import { db, STORES } from '../../services/db/dexie';
import { useActiveOrders } from './useActiveOrders';
import { Money } from '../../utils/moneyMath';
import { validateFefoSelectionBeforeCheckout } from '../../services/sales/fefoSaleValidation';
import { getRestaurantOrderCloudStatusSnapshot } from '../restaurant/useRestaurantOrderCloudStatus';
import { reconcileCartWithCancelledRestaurantItems } from '../../services/restaurant/restaurantOrderReconciliation';
import {
    closeRestaurantCloudOrderAfterSuccessfulPayment,
    retryPendingRestaurantCloudOrderCloses
} from '../../services/restaurant/restaurantOrderCheckoutClose';
import {
    isCloudSalesCashierEnabled,
    isCloudSalesCreditEnabled,
    isRestaurantOrdersCloudEnabled
} from '../../services/sync/syncConstants';
import {
    ECOMMERCE_POS_CHECKOUT_MESSAGE,
    getEcommercePosBlockedResult,
    isEcommercePosEffectBlocked
} from '../../services/ecommerce/ecommercePosDraftGuards';

const CLOUD_TURN_REQUIRED_PAYMENT_METHODS = new Set(['cash', 'card', 'transfer', 'credit', 'mixed']);
const POS_CHECKOUT_SNAPSHOT_STALE = 'POS_CHECKOUT_SNAPSHOT_STALE';
const POS_CHECKOUT_SNAPSHOT_STALE_MESSAGE = 'La orden activa cambió. Cierra el cobro y vuelve a iniciarlo desde la orden actual.';

const CHECKOUT_INTEGRITY_OPTIONS = {
    reason: 'sale_checkout',
    transactionMode: true,
    refreshProfile: false,
    forceRemote: false,
    allowLocalOnly: true
};

const createCheckoutAttemptId = () => {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }

    return `checkout-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const countSellableItems = (items = []) => (
    (Array.isArray(items) ? items : []).filter((item) => Number(item?.quantity) > 0).length
);

const shouldRequireOpenCashSessionForCloudSale = (licenseDetails) => Boolean(
    licenseDetails?.valid &&
    (
        isCloudSalesCashierEnabled(licenseDetails) ||
        isCloudSalesCreditEnabled(licenseDetails)
    )
);

const hasOpenCashSession = (session) => (
    session?.estado === 'abierta' || session?.status === 'open'
);

const buildCashNeedsOpeningError = () => Object.assign(
    new Error('La caja requiere apertura manual. Confirma el fondo inicial.'),
    { code: 'CAJA_NEEDS_OPENING' }
);

const getPosCheckoutSnapshotStaleResult = () => ({
    success: false,
    code: POS_CHECKOUT_SNAPSHOT_STALE,
    message: POS_CHECKOUT_SNAPSHOT_STALE_MESSAGE
});

const normalizePaymentMethod = (method) => {
    const raw = String(method || '').trim().toLowerCase();

    if (['cash', 'efectivo'].includes(raw)) return 'cash';
    if (['card', 'tarjeta', 'tarjeta_credito', 'tarjeta_debito', 'debit', 'credit_card', 'debit_card'].includes(raw)) return 'card';
    if (['transfer', 'transferencia', 'spei', 'bank_transfer'].includes(raw)) return 'transfer';
    if (['mixed', 'mixto'].includes(raw)) return 'mixed';
    if (['fiado', 'credit', 'credito', 'crédito', 'customer_credit', 'mixed_credit', 'partial_credit'].includes(raw)) return 'credit';

    return raw;
};

const deepClone = (value) => {
    if (typeof structuredClone === 'function') return structuredClone(value);
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((item) => deepClone(item));

    return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, deepClone(item)])
    );
};

const buildKitchenReviewResult = (overrides = {}) => ({
    canContinue: true,
    orderItems: null,
    removedCancelledItems: [],
    removedCount: 0,
    ...overrides
});

const confirmKitchenStatusBeforeCheckout = async ({
    licenseDetails,
    localOrderId,
    orderItems = [],
    shouldVerifyCloudKitchen = false
}) => {
    if (!shouldVerifyCloudKitchen || !localOrderId) {
        return buildKitchenReviewResult();
    }

    try {
        const response = await getRestaurantOrderCloudStatusSnapshot({
            licenseDetails,
            localOrderId,
            force: true
        });

        if (response?.skipped || response?.found === false || !response?.order) {
            return buildKitchenReviewResult();
        }

        if (response?.success === false) {
            showMessageModal(
                'No se pudo verificar cocina cloud. Revisa la mesa antes de cobrar.',
                null,
                {
                    title: 'Verificación de cocina no disponible',
                    type: 'warning',
                    confirmButtonText: 'Entendido'
                }
            );
            return buildKitchenReviewResult({ canContinue: false });
        }

        const summary = response.summary || {};

        if (summary.hasCancelledItems) {
            const reconciliation = reconcileCartWithCancelledRestaurantItems(orderItems, summary.items);

            if (reconciliation.hasUnmatchedCancelledItems) {
                await showConfirmModal(
                    'Hay items cancelados en cocina que no se pudieron empatar con la cuenta. Abre la mesa y revisa antes de cobrar.',
                    {
                        title: summary.isCancelled ? 'Comanda cancelada en cocina' : 'Items cancelados en cocina',
                        type: 'warning',
                        confirmButtonText: 'Entendido',
                        showCancel: false
                    }
                );

                return buildKitchenReviewResult({ canContinue: false });
            }

            if (reconciliation.hasRemovableCancelledItems) {
                const confirmed = await showConfirmModal(
                    `Cocina canceló ${reconciliation.removedCount} item(s). Se retirarán de la cuenta antes de cobrar.`,
                    {
                        title: 'Ajustar cuenta antes de cobrar',
                        type: 'warning',
                        confirmButtonText: 'Retirar y cobrar',
                        cancelButtonText: 'Revisar mesa'
                    }
                );

                if (!confirmed) {
                    return buildKitchenReviewResult({ canContinue: false });
                }

                if (countSellableItems(reconciliation.kept) === 0) {
                    showMessageModal(
                        'No quedan productos activos para cobrar. Anula la venta si cocina canceló toda la comanda.',
                        null,
                        { type: 'warning' }
                    );
                    return buildKitchenReviewResult({ canContinue: false });
                }

                return buildKitchenReviewResult({
                    orderItems: reconciliation.kept,
                    removedCancelledItems: reconciliation.removed,
                    removedCount: reconciliation.removedCount
                });
            }

            return buildKitchenReviewResult();
        }

        if (summary.hasPendingItems || summary.hasPreparingItems || (!summary.isReady && !summary.isCancelled)) {
            const canContinue = await showConfirmModal(
                'La comanda aún no está marcada como lista en cocina.',
                {
                    title: 'Comanda aún en cocina',
                    type: 'warning',
                    confirmButtonText: 'Continuar de todos modos',
                    cancelButtonText: 'Volver a revisar'
                }
            );
            return buildKitchenReviewResult({ canContinue });
        }

        return buildKitchenReviewResult();
    } catch (error) {
        console.warn('[REST.5.1] No se pudo verificar cocina cloud antes de cobrar:', error);
        showMessageModal(
            'No se pudo verificar cocina cloud. Revisa la mesa antes de cobrar.',
            null,
            {
                title: 'Verificación de cocina no disponible',
                type: 'warning',
                confirmButtonText: 'Entendido'
            }
        );
        return buildKitchenReviewResult({ canContinue: false });
    }
};

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
    const asegurarCajaAbierta = pos.asegurarCajaAbierta;
    const checkoutSnapshotRef = useRef(null);
    const handleProcessOrderRef = useRef(null);

    const getLiveCheckoutContext = useCallback(() => {
        const state = useActiveOrders.getState();
        const orderId = state.currentOrderId || pos.activeOrderId || null;
        const activeOrder = orderId
            ? state.activeOrders.get(orderId) || null
            : null;

        return { state, orderId, activeOrder };
    }, [pos.activeOrderId]);

    const setCheckoutAttemptOwnerInMemory = useCallback((orderId, checkoutAttemptId) => {
        const state = useActiveOrders.getState();
        const order = state.activeOrders.get(orderId);
        if (!order) return;

        const nextOrders = new Map(state.activeOrders);
        nextOrders.set(orderId, { ...order, checkoutAttemptId });
        useActiveOrders.setState({ activeOrders: nextOrders });
    }, []);

    const persistCheckoutAttemptOwnership = useCallback(async (orderId, checkoutAttemptId) => {
        try {
            await db.transaction('rw', db.table(STORES.SALES), async () => {
                const existing = await db.table(STORES.SALES).get(orderId);
                if (!existing?.isLockedForCheckout) {
                    throw new Error('checkout_lock_missing_after_acquire');
                }
                await db.table(STORES.SALES).update(orderId, { checkoutAttemptId });
            });
            setCheckoutAttemptOwnerInMemory(orderId, checkoutAttemptId);
            return { success: true };
        } catch (error) {
            console.error('[usePosCheckout] No se pudo registrar la propiedad del lock:', {
                orderId,
                checkoutAttemptId,
                error: error?.message || 'checkout_lock_owner_persist_failed'
            });
            return {
                success: false,
                code: 'CHECKOUT_LOCK_OWNER_PERSIST_FAILED',
                message: error?.message || 'checkout_lock_owner_persist_failed'
            };
        }
    }, [setCheckoutAttemptOwnerInMemory]);

    const showEcommerceCheckoutBlocked = useCallback(() => {
        showMessageModal(
            ECOMMERCE_POS_CHECKOUT_MESSAGE,
            null,
            { type: 'warning' }
        );
        return getEcommercePosBlockedResult();
    }, []);

    const showStaleSnapshotBlocked = useCallback(() => {
        showMessageModal(
            POS_CHECKOUT_SNAPSHOT_STALE_MESSAGE,
            null,
            { type: 'warning' }
        );
        return getPosCheckoutSnapshotStaleResult();
    }, []);

    const releaseCheckoutSnapshotLock = useCallback(async (snapshot, { reason = 'unspecified' } = {}) => {
        if (!snapshot?.orderId) {
            return { success: true, released: false, reason: 'missing_order_id' };
        }
        if (snapshot.lockOwnedByCheckout !== true) {
            return { success: true, released: false, reason: 'lock_not_owned', orderId: snapshot.orderId };
        }
        if (snapshot.lockReleased === true) {
            return { success: true, released: false, reason: 'already_released', orderId: snapshot.orderId };
        }
        if (snapshot.lockReleasePromise) {
            return snapshot.lockReleasePromise;
        }

        snapshot.lockReleaseInFlight = true;
        const releasePromise = (async () => {
            try {
                let unlockResult = null;
                let ownershipResult = 'owned';

                await db.transaction('rw', db.table(STORES.SALES), async () => {
                    const persisted = await db.table(STORES.SALES).get(snapshot.orderId);
                    const memoryOrder = useActiveOrders.getState().activeOrders.get(snapshot.orderId) || null;
                    const persistedOwner = persisted?.checkoutAttemptId || null;
                    const memoryOwner = memoryOrder?.checkoutAttemptId || null;

                    if (persisted?.isLockedForCheckout === false && memoryOrder?.isLockedForCheckout !== true) {
                        ownershipResult = 'already_released';
                        return;
                    }

                    if (
                        !snapshot.checkoutAttemptId ||
                        (persistedOwner && persistedOwner !== snapshot.checkoutAttemptId) ||
                        (memoryOwner && memoryOwner !== snapshot.checkoutAttemptId) ||
                        (!persistedOwner && !memoryOwner)
                    ) {
                        ownershipResult = 'lock_not_owned';
                        return;
                    }

                    unlockResult = await useActiveOrders.getState().unlockOrder(snapshot.orderId);
                    if (unlockResult?.success === false) {
                        throw new Error(unlockResult?.reason || 'unlock_order_failed');
                    }

                    const latestPersisted = await db.table(STORES.SALES).get(snapshot.orderId);
                    if (latestPersisted) {
                        await db.table(STORES.SALES).update(snapshot.orderId, { checkoutAttemptId: null });
                    }
                });

                if (ownershipResult !== 'owned') {
                    snapshot.lockReleased = true;
                    snapshot.lockOwnedByCheckout = false;
                    snapshot.lockReleaseInFlight = false;
                    snapshot.lockReleasePromise = null;
                    snapshot.lockReleaseError = null;
                    return {
                        success: true,
                        released: false,
                        reason: ownershipResult,
                        orderId: snapshot.orderId,
                        checkoutAttemptId: snapshot.checkoutAttemptId
                    };
                }

                setCheckoutAttemptOwnerInMemory(snapshot.orderId, null);
                snapshot.lockReleased = true;
                snapshot.lockOwnedByCheckout = false;
                snapshot.lockReleaseInFlight = false;
                snapshot.lockReleasePromise = null;
                snapshot.lockReleaseError = null;

                return {
                    success: true,
                    released: true,
                    orderId: snapshot.orderId,
                    checkoutAttemptId: snapshot.checkoutAttemptId,
                    unlockResult
                };
            } catch (error) {
                snapshot.lockReleaseInFlight = false;
                snapshot.lockReleasePromise = null;
                snapshot.lockReleaseError = {
                    reason,
                    message: error?.message || 'unlock_order_failed'
                };
                console.error('[usePosCheckout] No se pudo liberar el lock propio del checkout:', {
                    orderId: snapshot.orderId,
                    checkoutAttemptId: snapshot.checkoutAttemptId,
                    reason,
                    error: error?.message || 'unlock_order_failed'
                });
                return {
                    success: false,
                    released: false,
                    reason: 'unlock_failed',
                    orderId: snapshot.orderId,
                    checkoutAttemptId: snapshot.checkoutAttemptId
                };
            }
        })();

        snapshot.lockReleasePromise = releasePromise;
        return releasePromise;
    }, [setCheckoutAttemptOwnerInMemory]);

    const clearCheckoutSnapshotIfResolved = useCallback((snapshot) => {
        if (
            checkoutSnapshotRef.current === snapshot &&
            (snapshot?.lockReleased === true || snapshot?.lockOwnedByCheckout !== true || snapshot?.consumed === true)
        ) {
            checkoutSnapshotRef.current = null;
            return true;
        }
        return false;
    }, []);

    const invalidateCheckoutSnapshot = useCallback(async (
        snapshot,
        { releaseLock = true, reason = 'snapshot_invalidated' } = {}
    ) => {
        if (!snapshot) {
            return { success: true, invalidated: false, released: false, reason: 'missing_snapshot' };
        }

        snapshot.invalidated = true;
        snapshot.invalidationReason = reason;

        let releaseResult = { success: true, released: false, reason: 'release_not_requested' };
        if (releaseLock) {
            releaseResult = await releaseCheckoutSnapshotLock(snapshot, { reason });
        }

        if (!releaseLock || releaseResult.success) {
            clearCheckoutSnapshotIfResolved(snapshot);
        }

        return {
            success: releaseResult.success,
            invalidated: true,
            released: releaseResult.released === true,
            orderId: snapshot.orderId,
            reason: releaseResult.reason || reason
        };
    }, [clearCheckoutSnapshotIfResolved, releaseCheckoutSnapshotLock]);

    const blockEcommerceCheckoutEffect = useCallback(async ({ invalidateSnapshot = false } = {}) => {
        const { activeOrder } = getLiveCheckoutContext();
        if (!isEcommercePosEffectBlocked(activeOrder)) return null;

        if (invalidateSnapshot && checkoutSnapshotRef.current) {
            await invalidateCheckoutSnapshot(checkoutSnapshotRef.current, {
                releaseLock: true,
                reason: 'live_order_became_ecommerce'
            });
        }

        return showEcommerceCheckoutBlocked();
    }, [getLiveCheckoutContext, invalidateCheckoutSnapshot, showEcommerceCheckoutBlocked]);

    const validateLiveCheckoutTarget = useCallback((expectedOrderId) => {
        const { orderId, activeOrder } = getLiveCheckoutContext();

        if (isEcommercePosEffectBlocked(activeOrder)) {
            return showEcommerceCheckoutBlocked();
        }

        if (!expectedOrderId || !orderId || !activeOrder || orderId !== expectedOrderId) {
            return showStaleSnapshotBlocked();
        }

        return null;
    }, [getLiveCheckoutContext, showEcommerceCheckoutBlocked, showStaleSnapshotBlocked]);

    const validateLiveCheckoutSnapshot = useCallback(async (snapshot) => {
        const { orderId, activeOrder } = getLiveCheckoutContext();

        if (isEcommercePosEffectBlocked(activeOrder)) {
            if (snapshot) {
                await invalidateCheckoutSnapshot(snapshot, {
                    releaseLock: true,
                    reason: 'live_order_is_ecommerce'
                });
            }
            return showEcommerceCheckoutBlocked();
        }

        if (
            !snapshot ||
            snapshot.invalidated ||
            !snapshot.orderId ||
            !orderId ||
            !activeOrder ||
            snapshot.orderId !== orderId
        ) {
            if (snapshot) {
                await invalidateCheckoutSnapshot(snapshot, {
                    releaseLock: true,
                    reason: 'checkout_snapshot_stale'
                });
            }
            return showStaleSnapshotBlocked();
        }

        return null;
    }, [getLiveCheckoutContext, invalidateCheckoutSnapshot, showEcommerceCheckoutBlocked, showStaleSnapshotBlocked]);

    const prepareForNewCheckout = useCallback(async () => {
        const existingSnapshot = checkoutSnapshotRef.current;
        if (!existingSnapshot) return null;

        const cleanup = await invalidateCheckoutSnapshot(existingSnapshot, {
            releaseLock: true,
            reason: 'new_checkout_started'
        });
        if (cleanup.success) return null;

        showMessageModal(
            'No se pudo liberar el cobro anterior. Cierra el modal e intenta nuevamente.',
            null,
            { type: 'warning' }
        );
        return { success: false, code: 'CHECKOUT_LOCK_RELEASE_FAILED' };
    }, [invalidateCheckoutSnapshot]);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;

        const retryPendingCloses = () => {
            const licenseDetails = useAppStore.getState().licenseDetails;
            retryPendingRestaurantCloudOrderCloses({ licenseDetails, features }).catch((error) => {
                console.warn('[REST.7] No se pudieron reintentar cierres pendientes de cocina cloud:', error);
            });
        };

        retryPendingCloses();
        window.addEventListener('online', retryPendingCloses);
        return () => window.removeEventListener('online', retryPendingCloses);
    }, [features]);

    const handlePaymentModalClose = useCallback(async () => {
        const snapshot = checkoutSnapshotRef.current;
        if (snapshot) {
            const releaseResult = await releaseCheckoutSnapshotLock(snapshot, { reason: 'payment_modal_closed' });
            if (releaseResult.success) {
                clearCheckoutSnapshotIfResolved(snapshot);
            }
        }
        modal.closeModal('payment');
    }, [clearCheckoutSnapshotIfResolved, modal, releaseCheckoutSnapshotLock]);

    const handleQuickCajaClose = useCallback(async () => {
        const snapshot = checkoutSnapshotRef.current;
        if (snapshot) {
            const releaseResult = await releaseCheckoutSnapshotLock(snapshot, { reason: 'quick_caja_closed' });
            if (releaseResult.success) {
                clearCheckoutSnapshotIfResolved(snapshot);
            }
        }

        modal.closeModal('quickCaja');

        if (snapshot?.orderId) {
            showMessageModal(
                'Apertura de caja cancelada. La venta no se cobró; puedes volver a cobrar cuando abras caja.',
                null,
                { type: 'warning' }
            );
        }
    }, [clearCheckoutSnapshotIfResolved, modal, releaseCheckoutSnapshotLock]);

    const handleInitiateCheckout = useCallback(async () => {
        const previousCheckoutError = await prepareForNewCheckout();
        if (previousCheckoutError) return previousCheckoutError;

        const ecommerceBlocked = await blockEcommerceCheckoutEffect();
        if (ecommerceBlocked) return ecommerceBlocked;

        const licenseDetails = useAppStore.getState().licenseDetails;
        if (!licenseDetails || !licenseDetails.valid) {
            showMessageModal('⚠️ Error de Seguridad: Licencia no válida.');
            return undefined;
        }

        const activeOrdersState = useActiveOrders.getState();
        const activeOrderId = activeOrdersState.currentOrderId || pos.activeOrderId;
        const activeOrder = activeOrderId ? activeOrdersState.activeOrders.get(activeOrderId) : null;
        let orderItems = Array.isArray(activeOrder?.items) ? activeOrder.items : pos.order;
        const pendingInventoryCount = activeOrdersState.pendingInventoryResolutions?.get(activeOrderId) || 0;

        if (pendingInventoryCount > 0) {
            showMessageModal(
                'Espera a que termine la asignación de inventario antes de cobrar.',
                null,
                { type: 'warning' }
            );
            return undefined;
        }

        const shouldVerifyCloudKitchen = Boolean(
            features?.hasTables &&
            activeOrder?.isSaved &&
            isRestaurantOrdersCloudEnabled(licenseDetails)
        );

        if (features?.hasTables) {
            const kitchenReview = await confirmKitchenStatusBeforeCheckout({
                licenseDetails,
                localOrderId: activeOrderId,
                orderItems,
                shouldVerifyCloudKitchen
            });

            const afterKitchenTargetError = validateLiveCheckoutTarget(activeOrderId);
            if (afterKitchenTargetError) return afterKitchenTargetError;

            if (!kitchenReview.canContinue) {
                return undefined;
            }

            if (Array.isArray(kitchenReview.orderItems)) {
                orderItems = kitchenReview.orderItems;
                const activeOrdersApi = useActiveOrders.getState();
                activeOrdersApi.updateOrderItems(activeOrderId, orderItems);

                const updatedOrder = useActiveOrders.getState().activeOrders.get(activeOrderId);
                const saveResult = await useActiveOrders.getState().saveOrderAsOpen(activeOrderId, updatedOrder);
                if (!saveResult?.success) {
                    showMessageModal(
                        saveResult?.message || 'No se pudo actualizar la mesa antes de cobrar.',
                        null,
                        { type: 'error' }
                    );
                    return saveResult;
                }

                const afterSaveTargetError = validateLiveCheckoutTarget(activeOrderId);
                if (afterSaveTargetError) return afterSaveTargetError;

                const persistedSale = await db.table(STORES.SALES).get(activeOrderId);
                const persistedItems = Array.isArray(persistedSale?.items) ? persistedSale.items : orderItems;
                useActiveOrders.getState().updateOrderItems(activeOrderId, persistedItems);
                orderItems = persistedItems;

                if (kitchenReview.removedCount > 0) {
                    showMessageModal(
                        'Se retiraron de la cuenta los items cancelados por cocina antes de cobrar.',
                        null,
                        { type: 'success' }
                    );
                }
            }
        }

        const beforeLockTargetError = validateLiveCheckoutTarget(activeOrderId);
        if (beforeLockTargetError) return beforeLockTargetError;

        const itemsToProcess = orderItems.filter((item) => item.quantity && item.quantity > 0);
        if (itemsToProcess.length === 0) {
            showMessageModal('El pedido está vacío.', null, { type: 'warning' });
            return undefined;
        }

        const checkoutAttemptId = createCheckoutAttemptId();
        const lockResult = await useActiveOrders.getState().lockOrderForCheckout(activeOrderId);
        if (!lockResult.success) {
            showMessageModal(`⚠️ No se puede iniciar el cobro: ${lockResult.reason}`, null, { type: 'warning' });
            return lockResult;
        }

        const ownershipResult = await persistCheckoutAttemptOwnership(activeOrderId, checkoutAttemptId);
        if (!ownershipResult.success) {
            await useActiveOrders.getState().unlockOrder(activeOrderId);
            showMessageModal(
                'No se pudo asegurar la propiedad del cobro. Intenta nuevamente.',
                null,
                { type: 'warning' }
            );
            return ownershipResult;
        }

        const snapshot = {
            orderId: activeOrderId,
            checkoutAttemptId,
            lockOwnedByCheckout: true,
            lockReleased: false,
            lockReleaseInFlight: false,
            lockReleasePromise: null,
            invalidated: false,
            consumed: false,
            order: null,
            total: null,
            tableData: null
        };
        checkoutSnapshotRef.current = snapshot;

        const lockedState = useActiveOrders.getState();
        const lockedOrder = lockedState.activeOrders.get(activeOrderId);
        const pendingAfterLock = lockedState.pendingInventoryResolutions?.get(activeOrderId) || 0;

        const afterLockTargetError = await validateLiveCheckoutSnapshot(snapshot);
        if (afterLockTargetError) return afterLockTargetError;

        if (pendingAfterLock > 0 || !lockedOrder) {
            await invalidateCheckoutSnapshot(snapshot, {
                releaseLock: true,
                reason: pendingAfterLock > 0 ? 'inventory_pending_after_lock' : 'order_missing_after_lock'
            });
            showMessageModal(
                pendingAfterLock > 0
                    ? 'Espera a que termine la asignación de inventario antes de cobrar.'
                    : 'No se encontró la orden activa para iniciar el cobro.',
                null,
                { type: 'warning' }
            );
            return undefined;
        }

        const lockedItemsToProcess = lockedOrder.items.filter((item) => item.quantity && item.quantity > 0);
        if (lockedItemsToProcess.length === 0) {
            await invalidateCheckoutSnapshot(snapshot, { releaseLock: true, reason: 'empty_order_after_lock' });
            showMessageModal('El pedido está vacío.', null, { type: 'warning' });
            return undefined;
        }

        const fefoValidation = await validateFefoSelectionBeforeCheckout(
            lockedItemsToProcess,
            posSearch.menuVisual
        );

        const afterFefoTargetError = await validateLiveCheckoutSnapshot(snapshot);
        if (afterFefoTargetError) return afterFefoTargetError;

        if (fefoValidation.blocked) {
            await invalidateCheckoutSnapshot(snapshot, { releaseLock: true, reason: 'fefo_blocked' });
            showMessageModal(
                fefoValidation.message || 'Hay un lote vencido que no puede venderse.',
                null,
                { type: 'error' }
            );
            return fefoValidation;
        }

        if (fefoValidation.warnings?.length > 0) {
            console.info('[CAD.5 FEFO] Advertencias preventivas de selección:', fefoValidation.warnings);
        }

        snapshot.order = deepClone(lockedOrder.items);
        snapshot.total = Number(lockedOrder.total);
        snapshot.tableData = deepClone(lockedOrder.tableData ?? null);

        const itemsRequiring = features?.hasLabFields
            ? lockedItemsToProcess.filter((item) =>
                item.requiresPrescription ||
                (item.prescriptionType && item.prescriptionType !== 'otc')
            )
            : [];

        prescription.setTempPrescriptionData(null);
        mobileCart.closeCart();

        if (itemsRequiring.length > 0) {
            prescription.setPrescriptionItems(itemsRequiring);
            modal.openModal('prescription');
        } else {
            modal.openModal('payment');
        }

        return { success: true, orderId: activeOrderId, checkoutAttemptId };
    }, [
        blockEcommerceCheckoutEffect,
        invalidateCheckoutSnapshot,
        mobileCart,
        modal,
        pos.activeOrderId,
        pos.order,
        posSearch.menuVisual,
        persistCheckoutAttemptOwnership,
        prepareForNewCheckout,
        prescription,
        features?.hasLabFields,
        features?.hasTables,
        validateLiveCheckoutSnapshot,
        validateLiveCheckoutTarget
    ]);

    const handleProcessOrder = useCallback(async (paymentData, forceSale = false) => {
        const snapshot = checkoutSnapshotRef.current;
        const initialSnapshotError = await validateLiveCheckoutSnapshot(snapshot);
        if (initialSnapshotError) {
            if (!snapshot) modal.closeModal('payment');
            return initialSnapshotError;
        }

        const isSessionValid = await verifySessionIntegrity(CHECKOUT_INTEGRITY_OPTIONS);
        if (!isSessionValid) {
            await invalidateCheckoutSnapshot(snapshot, { releaseLock: true, reason: 'session_invalid' });
            showMessageModal('Sesion invalida o licencia expirada. El sistema se recargará.', () => {
                window.location.reload();
            });
            return { success: false, code: 'SESSION_INVALID' };
        }

        const afterSessionSnapshotError = await validateLiveCheckoutSnapshot(snapshot);
        if (afterSessionSnapshotError) return afterSessionSnapshotError;

        if (paymentData.paymentMethod === 'fiado') {
            if (!paymentData.dueDate) {
                await invalidateCheckoutSnapshot(snapshot, { releaseLock: true, reason: 'credit_due_date_required' });
                showMessageModal('⚠️ Fecha de vencimiento es requerida para ventas a crédito.');
                modal.closeModal('payment');
                return { success: false, code: 'CREDIT_DUE_DATE_REQUIRED' };
            }

            const todayStr = new Date().toISOString().split('T')[0];
            const dueDateStr = paymentData.dueDate.split('T')[0];
            if (dueDateStr < todayStr) {
                await invalidateCheckoutSnapshot(snapshot, { releaseLock: true, reason: 'credit_due_date_invalid' });
                showMessageModal('⚠️ La fecha de vencimiento no puede ser en el pasado.');
                modal.closeModal('payment');
                return { success: false, code: 'CREDIT_DUE_DATE_INVALID' };
            }
        }

        const paymentMethod = normalizePaymentMethod(paymentData.paymentMethod);
        const initialPaymentMethod = normalizePaymentMethod(
            paymentData.initialPaymentMethod ||
            paymentData.abonoPaymentMethod ||
            paymentData.creditPaymentMethod ||
            paymentData.partialPaymentMethod ||
            'efectivo'
        );

        const hasInitialCreditPayment = paymentMethod === 'credit' && Money.init(paymentData.amountPaid || 0).gt(0);
        const hasCashComponent = paymentMethod === 'cash' || (hasInitialCreditPayment && initialPaymentMethod === 'cash');

        const licenseDetails = useAppStore.getState().licenseDetails;
        const cloudSalesTurnRequired = shouldRequireOpenCashSessionForCloudSale(licenseDetails);
        const requiresOpenCashSession = cloudSalesTurnRequired
            ? CLOUD_TURN_REQUIRED_PAYMENT_METHODS.has(paymentMethod)
            : hasCashComponent;

        if (requiresOpenCashSession && !hasOpenCashSession(pos.cajaActual)) {
            const beforeCajaSnapshotError = await validateLiveCheckoutSnapshot(snapshot);
            if (beforeCajaSnapshotError) return beforeCajaSnapshotError;

            try {
                const ensuredCashSession = await asegurarCajaAbierta?.();

                if (!hasOpenCashSession(ensuredCashSession)) {
                    throw buildCashNeedsOpeningError();
                }
            } catch (cashError) {
                if (cashError?.code === 'CAJA_NEEDS_OPENING') {
                    const beforeQuickCajaSnapshotError = await validateLiveCheckoutSnapshot(snapshot);
                    if (beforeQuickCajaSnapshotError) return beforeQuickCajaSnapshotError;

                    modal.closeModal('payment');
                    modal.openModal('quickCaja');
                    return { success: false, code: 'CAJA_NEEDS_OPENING' };
                }

                await invalidateCheckoutSnapshot(snapshot, { releaseLock: true, reason: 'cash_validation_failed' });
                showMessageModal(
                    cashError?.message || 'No se pudo verificar la caja abierta. Intenta de nuevo.',
                    null,
                    {
                        title: 'Caja requerida',
                        type: 'warning',
                        confirmButtonText: 'Entendido'
                    }
                );
                return { success: false, code: cashError?.code || 'CAJA_VALIDATION_FAILED' };
            }

            const afterCajaSnapshotError = await validateLiveCheckoutSnapshot(snapshot);
            if (afterCajaSnapshotError) return afterCajaSnapshotError;
        }

        const beforeSaleSnapshotError = await validateLiveCheckoutSnapshot(snapshot);
        if (beforeSaleSnapshotError) return beforeSaleSnapshotError;

        let isSuccess = false;
        let isStockWarning = false;

        try {
            const { processSale } = await import('../../services/salesService');
            const finalSnapshotError = await validateLiveCheckoutSnapshot(snapshot);
            if (finalSnapshotError) return finalSnapshotError;

            modal.closeModal('payment');

            const result = await processSale({
                order: snapshot.order,
                paymentData,
                total: snapshot.total,
                allProducts: posSearch.menuVisual,
                features,
                companyName: useAppStore.getState().companyProfile?.name || 'Tu Negocio',
                tempPrescriptionData: prescription.tempPrescriptionData,
                ignoreStock: forceSale,
                activeOrderId: snapshot.orderId
            });

            if (result.success) {
                isSuccess = true;
                snapshot.consumed = true;
                snapshot.lockReleased = true;
                snapshot.lockOwnedByCheckout = false;
                checkoutSnapshotRef.current = null;

                let kitchenCloseWarning = null;
                try {
                    const closeResult = await closeRestaurantCloudOrderAfterSuccessfulPayment({
                        localOrderId: snapshot.orderId,
                        saleResult: result,
                        paymentData,
                        licenseDetails,
                        saleTotal: snapshot.total,
                        features
                    });

                    if (closeResult?.success === false && !closeResult?.skipped) {
                        kitchenCloseWarning = 'La venta se cobró, pero no se pudo cerrar cocina cloud. Revisa conexión y actualiza Mesas/Cocina.';
                    }
                } catch (closeError) {
                    console.warn('[REST.7] Cierre cloud de cocina falló después del cobro:', closeError);
                    kitchenCloseWarning = 'La venta se cobró, pero no se pudo cerrar cocina cloud. Revisa conexión y actualiza Mesas/Cocina.';
                }

                try {
                    await useActiveOrders.getState().removeOrder(snapshot.orderId);
                } catch (closeErr) {
                    console.error('[usePosCheckout] Error eliminando orden en activeOrders:', closeErr);
                }

                prescription.setTempPrescriptionData(null);
                mobileCart.closeCart();

                if (kitchenCloseWarning) {
                    showMessageModal(kitchenCloseWarning, null, {
                        title: 'Cierre de cocina pendiente',
                        type: 'warning',
                        confirmButtonText: 'Entendido'
                    });
                } else {
                    showMessageModal('✅ ¡Venta registrada correctamente!');
                }

                broadcastDBChange({ action: 'sale-completed', saleId: result.saleId });
                await posSearch.refreshOutOfStock();
                await fetchActiveTablesCount();
            } else if (result.errorType === 'RACE_CONDITION') {
                showMessageModal('⚠️ El sistema está muy ocupado. Por favor intenta cobrar de nuevo.');
                await posSearch.refreshOutOfStock();
            } else if (result.errorType === 'STOCK_WARNING') {
                isStockWarning = true;
                checkoutSnapshotRef.current = snapshot;
                showMessageModal(
                    result.message,
                    async () => {
                        const snapshotError = await validateLiveCheckoutSnapshot(snapshot);
                        if (snapshotError) return snapshotError;

                        if (snapshot.lockOwnedByCheckout !== true || snapshot.lockReleased === true) {
                            const checkoutAttemptId = createCheckoutAttemptId();
                            const lockResult = await useActiveOrders.getState().lockOrderForCheckout(snapshot.orderId);
                            if (!lockResult.success) {
                                showMessageModal(`⚠️ No se puede forzar el cobro: ${lockResult.reason}`, null, { type: 'warning' });
                                return lockResult;
                            }
                            const ownershipResult = await persistCheckoutAttemptOwnership(snapshot.orderId, checkoutAttemptId);
                            if (!ownershipResult.success) {
                                await useActiveOrders.getState().unlockOrder(snapshot.orderId);
                                return ownershipResult;
                            }
                            snapshot.checkoutAttemptId = checkoutAttemptId;
                            snapshot.lockOwnedByCheckout = true;
                            snapshot.lockReleased = false;
                            snapshot.lockReleaseError = null;
                        }

                        return handleProcessOrderRef.current?.(paymentData, true);
                    },
                    { confirmButtonText: 'Sí, Vender Igual', type: 'warning' }
                );
            } else {
                showMessageModal(`Error: ${result.message}`, null, { type: 'error' });
            }

            return result;
        } catch (error) {
            console.error('[usePosCheckout] Error crítico en UI:', error);
            showMessageModal(`Error inesperado: ${error.message}`);
            return { success: false, message: error.message };
        } finally {
            if (!isSuccess && !isStockWarning) {
                const releaseResult = await releaseCheckoutSnapshotLock(snapshot, { reason: 'process_failed' });
                if (releaseResult.success) {
                    clearCheckoutSnapshotIfResolved(snapshot);
                }
            }
        }
    }, [
        asegurarCajaAbierta,
        clearCheckoutSnapshotIfResolved,
        features,
        fetchActiveTablesCount,
        invalidateCheckoutSnapshot,
        mobileCart,
        modal,
        pos.cajaActual,
        posSearch,
        persistCheckoutAttemptOwnership,
        prescription,
        releaseCheckoutSnapshotLock,
        validateLiveCheckoutSnapshot,
        verifySessionIntegrity
    ]);

    useEffect(() => {
        handleProcessOrderRef.current = handleProcessOrder;
    }, [handleProcessOrder]);

    const handleQuickCajaSubmit = useCallback(async (openingData) => {
        const snapshot = checkoutSnapshotRef.current;
        const initialSnapshotError = await validateLiveCheckoutSnapshot(snapshot);
        if (initialSnapshotError) return initialSnapshotError;

        const success = await abrirCaja(openingData);
        if (success) {
            const afterOpenSnapshotError = await validateLiveCheckoutSnapshot(snapshot);
            if (afterOpenSnapshotError) {
                showMessageModal(
                    'La caja se abrió, pero la orden cambió. El cobro fue cancelado y la orden anterior quedó desbloqueada.',
                    null,
                    { type: 'warning' }
                );
                return afterOpenSnapshotError;
            }

            try {
                const ensuredCashSession = await asegurarCajaAbierta?.();
                if (!hasOpenCashSession(ensuredCashSession)) {
                    throw buildCashNeedsOpeningError();
                }
            } catch (cashError) {
                const releaseResult = await releaseCheckoutSnapshotLock(snapshot, { reason: 'quick_caja_validation_failed' });
                if (releaseResult.success) {
                    clearCheckoutSnapshotIfResolved(snapshot);
                }
                showMessageModal(
                    cashError?.message || 'La caja se abrió, pero no se pudo confirmar la sesión abierta. Intenta de nuevo.',
                    null,
                    {
                        title: 'Verificación de caja pendiente',
                        type: 'warning',
                        confirmButtonText: 'Entendido'
                    }
                );
                return false;
            }

            const beforePaymentSnapshotError = await validateLiveCheckoutSnapshot(snapshot);
            if (beforePaymentSnapshotError) return beforePaymentSnapshotError;

            modal.closeModal('quickCaja');
            modal.openModal('payment');
        }
        return success;
    }, [
        abrirCaja,
        asegurarCajaAbierta,
        clearCheckoutSnapshotIfResolved,
        modal,
        releaseCheckoutSnapshotLock,
        validateLiveCheckoutSnapshot
    ]);

    return {
        handleInitiateCheckout,
        handleProcessOrder,
        handlePaymentModalClose,
        handleQuickCajaClose,
        handleQuickCajaSubmit
    };
}
