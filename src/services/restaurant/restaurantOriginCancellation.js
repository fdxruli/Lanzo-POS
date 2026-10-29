import { db, STORES } from '../db/dexie';
import { useAppStore } from '../../store/useAppStore';
import { captureRefundsActorHandle } from '../auth/refundsActorAuthorization';
import { runTrackedActorOperationWithHandle } from '../auth/actorOperationalHandoff';
import { getLicenseKeyFromDetails, isRestaurantOrdersCloudEnabled } from '../sync/syncConstants';
import { restaurantOrdersRepository } from './restaurantOrdersRepository';
import { preflightCloudRestaurantOrderSettlement } from './restaurantSplitCloudPreflight';
import { stableRestaurantSplitCommercialStringify } from './restaurantSplitCommercialSnapshot';
import { isRestaurantCloudTableSettlementRequired, isRestaurantCloudTableShadow } from './restaurantCloudTableGuards';
import { generateIdempotencyKey } from '../sync/idempotency';
import { RESTAURANT_CLOUD_STATUS_EVENT } from './restaurantCloudStatusSummary';

const operations = new Map();
const failure = (code, message) => Object.assign(new Error(message), { code });
const unknown = () => failure('RESTAURANT_CANCEL_UNCONFIRMED', 'No se pudo confirmar la cancelación. Actualiza la mesa antes de intentarlo nuevamente.');
const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
const confirmed = (receipt, id) => receipt?.success === true && receipt.localOrderId === id
  && receipt.status === 'cancelled' && Boolean(receipt.cancelledAt && receipt.updatedAt)
  && Number.isSafeInteger(Number(receipt.serverVersion)) && Number(receipt.serverVersion) > 0;

const cancellationEvidence = (response, id) => {
  const order = response?.order;
  if (response?.success !== true || response.found !== true || order?.localOrderId !== id
    || order.status !== 'cancelled' || order.metadata?.cancelledFromPos !== true
    || order.paymentStatus === 'paid' || order.paidAt || order.paidSaleId) return null;
  const receipt = { success: true, localOrderId: id, status: 'cancelled', serverVersion: order.serverVersion,
    updatedAt: order.updatedAt, cancelledAt: order.cancelledAt };
  return confirmed(receipt, id) ? receipt : null;
};

// All local cancellation callers share this gate. Free/local orders never
// contact Cloud. Known parents, including legacy origins without parent IDs,
// must be resolved before any local release.
export const cancelOriginRestaurantTable = ({ orderId, actorHandle = null, reason = 'Mesa cancelada desde Punto de Venta', cancelLocal, onCloudConfirmed = () => {} }) => {
  const actor = actorHandle || captureRefundsActorHandle();
  actor.assertCurrent('refunds');
  const key = `${actor.tenant?.opaqueId || ''}:${orderId}`;
  if (operations.has(key)) return operations.get(key);
  const promise = runTrackedActorOperationWithHandle(actor, 'restaurant-origin-cancel', async () => {
      const table = db.table(STORES.SALES);
      const sale = await table.get(orderId);
      actor.assertCurrent('refunds');
      if (!sale || sale.status !== 'open') return;
      if (sale.isLockedForCheckout === true) throw failure('RESTAURANT_ORDER_CHECKOUT_LOCKED', 'La mesa tiene un cobro en curso. Cierra ese intento antes de cancelar.');
      if (isRestaurantCloudTableShadow(sale)) throw failure('CLOUD_TABLE_READ_ONLY', 'Cancela esta mesa desde el dispositivo de origen.');
      let receipt = sale.restaurantCancellationCleanupPending?.receipt;
      const details = useAppStore.getState().licenseDetails;
      const licenseKey = getLicenseKeyFromDetails(details);
      const knownParent = isRestaurantCloudTableSettlementRequired(sale);
      const cloudEnabled = isRestaurantOrdersCloudEnabled(details);
      const tableOrder = sale.orderType === 'table' || Boolean(sale.tableData);
      if (!confirmed(receipt, orderId) && (knownParent || (cloudEnabled && tableOrder))) {
        if (offline()) throw failure('RESTAURANT_CANCEL_OFFLINE', 'Necesitas conexión para cancelar esta mesa de forma segura.');
        const remote = await restaurantOrdersRepository.getRestaurantOrderByLocalOrder({ licenseKey, localOrderId: orderId, force: true });
        actor.assertCurrent('refunds');
        if (remote?.success !== true) throw unknown();
        receipt = cancellationEvidence(remote, orderId);
        if (!receipt && remote.found !== true) {
          if (knownParent) throw unknown();
          // An authoritative successful lookup proved that no Cloud parent exists.
        } else if (!receipt) {
          const parent = remote.order;
          if (parent?.paymentStatus === 'paid' || parent?.paidAt || parent?.paidSaleId) {
            throw failure('RESTAURANT_ORDER_ALREADY_PAID', 'La mesa ya fue cobrada. Actualiza las mesas antes de continuar.');
          }
          const preflight = await preflightCloudRestaurantOrderSettlement({
            licenseKey, parentOrderId: orderId, parentSale: sale, actorHandle: actor, permission: 'refunds',
            operation: 'cancel',
            // This response was forced above, under this same refunds actor.
            repository: { getRestaurantOrderByLocalOrder: async () => remote,
              getTableCapabilities: (args) => restaurantOrdersRepository.getTableCapabilities(args) }
          });
          actor.assertCurrent('refunds');
          if (preflight.success !== true) throw failure(preflight.code, preflight.code === 'RESTAURANT_ORDER_COMMERCIAL_CONFLICT'
            ? 'Los productos o importes de la mesa cambiaron. Revisa la cuenta actualizada antes de cancelar.'
            : preflight.message);
          const current = await table.get(orderId);
          actor.assertCurrent('refunds');
          if (!current || stableRestaurantSplitCommercialStringify(current) !== stableRestaurantSplitCommercialStringify(sale)) {
            throw failure('RESTAURANT_ORDER_VERSION_CONFLICT', 'La mesa cambió desde que la abriste. Revisa su estado actualizado antes de confirmar la cancelación.');
          }
          const expectedVersion = preflight.parentExpectedVersion;
          const idempotencyKey = generateIdempotencyKey({ entityType: 'restaurant_order', operation: 'cancel', entityId: orderId, prefix: 'restaurant-pos' });
          try {
            receipt = await restaurantOrdersRepository.cancelRestaurantOrderFromPos({ licenseKey, localOrderId: orderId,
              expectedVersion, reason, idempotencyKey, actorHandle: actor });
            if (!confirmed(receipt, orderId)) throw unknown();
          } catch (error) {
            actor.assertCurrent('refunds');
            // A failed response may follow a committed request. Re-read once;
            // never replay a destructive RPC or guess that it failed.
            const response = await restaurantOrdersRepository.getRestaurantOrderByLocalOrder({ licenseKey, localOrderId: orderId, force: true });
            actor.assertCurrent('refunds');
            receipt = cancellationEvidence(response, orderId);
            if (!receipt) {
              const rejectedCode = ['RESTAURANT_ORDER_VERSION_CONFLICT', 'RESTAURANT_ORDER_REMOTE_CANCEL_BLOCKED', 'RESTAURANT_ORDER_ALREADY_PAID']
                .find((code) => error?.code === code || error?.message?.includes(code));
              throw failure(rejectedCode || 'RESTAURANT_CANCEL_UNCONFIRMED',
                rejectedCode === 'RESTAURANT_ORDER_VERSION_CONFLICT'
                  ? 'La mesa cambió desde que la abriste. Revisa su estado actualizado antes de confirmar la cancelación.'
                  : rejectedCode === 'RESTAURANT_ORDER_REMOTE_CANCEL_BLOCKED'
                    ? 'Cancela esta mesa desde el dispositivo de origen.'
                    : rejectedCode === 'RESTAURANT_ORDER_ALREADY_PAID'
                      ? 'La mesa ya fue cobrada. Actualiza las mesas antes de continuar.'
                      : 'No se pudo confirmar la cancelación. Actualiza la mesa antes de intentarlo nuevamente.');
            }
          }
          actor.assertCurrent('refunds');
          if (!confirmed(receipt, orderId)) throw unknown();
        }
      }
      if (receipt) {
        if (!confirmed(receipt, orderId)) throw unknown();
        // Separate durable commit: a rollback in inventory cleanup must retain
        // the receipt and terminal guard. Recovery only repeats local cleanup.
        actor.assertCurrent('refunds');
        await table.update(orderId, {
          restaurantCancellationCleanupPending: { receipt },
          restaurantCloudTerminalState: 'terminal', restaurantCloudTerminalPaymentStatus: 'cancelled'
        });
        actor.assertCurrent('refunds');
        onCloudConfirmed(receipt);
      }
      try {
        await cancelLocal(Boolean(receipt));
      } catch (error) {
        if (receipt) throw Object.assign(failure('RESTAURANT_CANCEL_CLEANUP_PENDING', 'La mesa fue cancelada en la nube. Falta liberar sus reservas locales; se reintentará al actualizar las mesas.'), { cause: error });
        throw error;
      }
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new CustomEvent(RESTAURANT_CLOUD_STATUS_EVENT));
    }, 'refunds').finally(() => operations.delete(key));
  operations.set(key, promise);
  return promise;
};
