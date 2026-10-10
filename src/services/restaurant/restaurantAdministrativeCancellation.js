import { db, STORES } from '../db/dexie';
import { actorRuntimeController } from '../auth/actorRuntimeController';
import { restaurantOrdersRepository } from './restaurantOrdersRepository';
import { verifyRestaurantTableAuthority } from './restaurantTableAuthority';
import { generateIdempotencyKey } from '../sync/idempotency';
import { RESTAURANT_CLOUD_STATUS_EVENT } from './restaurantCloudStatusSummary';

// This RPC cancels Cloud, leaving the original device's durable reservation
// cleanup to the existing cancellation reconciliation. A shadow owns no holds.
export async function cancelAdministrativeRestaurantTable({ licenseKey, order, reason }) {
  const actor = actorRuntimeController.capture('refunds');
  if (actor.actorType !== 'admin') throw new Error('Se requiere una sesión administrativa vigente.');
  if (!reason?.trim()) throw new Error('Escribe el motivo de cancelación.');
  const authority = await verifyRestaurantTableAuthority({ licenseKey, order, operation: 'cancel', actorHandle: actor });
  actor.assertCurrent('refunds');
  const idempotencyKey = generateIdempotencyKey({ entityType: 'restaurant_order', operation: 'cancel',
    entityId: order.id, prefix: 'restaurant-admin' });
  const response = await restaurantOrdersRepository.cancelRestaurantOrderFromPos({ licenseKey,
    localOrderId: order.id, expectedVersion: authority.parentVersion, reason: reason.trim(), idempotencyKey, actorHandle: actor });
  actor.assertCurrent('refunds');
  if (response?.success !== true || response.localOrderId !== order.id || response.status !== 'cancelled'
    || !response.updatedAt || !response.cancelledAt || !(Number(response.serverVersion) > 0)) {
    throw new Error('No se pudo confirmar la cancelación. Actualiza la mesa antes de volver a intentarlo.');
  }
  // Durable receipt only. Never release reservations here, even on this device.
  await db.transaction('rw', db.table(STORES.SALES), async () => {
    actor.assertCurrent('refunds');
    const existing = await db.table(STORES.SALES).get(order.id);
    if (existing?.status === 'open') {
      await db.table(STORES.SALES).update(order.id, {
        restaurantCloudTerminalState: 'terminal', restaurantCloudTerminalPaymentStatus: 'cancelled',
        restaurantCancellationCleanupPending: { receipt: response }
      });
      actor.assertCurrent('refunds');
    }
  });
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(RESTAURANT_CLOUD_STATUS_EVENT));
  return response;
}
