import { db, STORES } from '../db/dexie';
import { useAppStore } from '../../store/useAppStore';
import { captureRefundsActorHandle } from '../auth/refundsActorAuthorization';
import { runTrackedActorOperationWithHandle } from '../auth/actorOperationalHandoff';
import { getLicenseKeyFromDetails, isRestaurantOrdersCloudEnabled } from '../sync/syncConstants';
import { restaurantOrdersRepository } from './restaurantOrdersRepository';
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
export const cancelOriginRestaurantTable = ({ orderId, actorHandle = null, cancelLocal, onCloudConfirmed = () => {} }) => {
  const actor = actorHandle || captureRefundsActorHandle();
  actor.assertCurrent('refunds');
  const key = `${actor.tenant?.opaqueId || ''}:${orderId}`;
  if (operations.has(key)) return operations.get(key);
  const promise = runTrackedActorOperationWithHandle(actor, 'restaurant-origin-cancel', async () => {
      const table = db.table(STORES.SALES);
      const sale = await table.get(orderId);
      actor.assertCurrent('refunds');
      if (!sale || sale.status !== 'open') return;
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
          const expectedVersion = sale.restaurantCloudExpectedVersion || sale.cloudRestaurantOrderUpdatedAt;
          if (!expectedVersion || expectedVersion !== parent?.updatedAt) {
            throw failure('RESTAURANT_ORDER_VERSION_CONFLICT', 'La mesa cambió. Actualízala y vuelve a abrirla antes de cancelar.');
          }
          const idempotencyKey = generateIdempotencyKey({ entityType: 'restaurant_order', operation: 'cancel', entityId: orderId, prefix: 'restaurant-pos' });
          try {
            receipt = await restaurantOrdersRepository.cancelRestaurantOrderFromPos({ licenseKey, localOrderId: orderId,
              expectedVersion, reason: 'Mesa cancelada desde Punto de Venta', idempotencyKey, actorHandle: actor });
            if (!confirmed(receipt, orderId)) throw unknown();
          } catch (error) {
            actor.assertCurrent('refunds');
            // A failed response may follow a committed request. Re-read once;
            // never replay a destructive RPC or guess that it failed.
            const response = await restaurantOrdersRepository.getRestaurantOrderByLocalOrder({ licenseKey, localOrderId: orderId, force: true });
            actor.assertCurrent('refunds');
            receipt = cancellationEvidence(response, orderId);
            if (!receipt) throw failure(error?.message?.includes('RESTAURANT_ORDER_VERSION_CONFLICT')
              ? 'RESTAURANT_ORDER_VERSION_CONFLICT' : 'RESTAURANT_CANCEL_UNCONFIRMED',
            'No se pudo confirmar la cancelación. Actualiza la mesa antes de intentarlo nuevamente.');
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
