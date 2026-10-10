import { actorRuntimeController } from '../auth/actorRuntimeController';
import { restaurantOrdersRepository } from './restaurantOrdersRepository';
import { bindRestaurantTableCapabilities, getRestaurantTableCapabilities } from './restaurantTableCapabilities';

const keys = { view: 'canViewTable', edit: 'canEditTable', kitchen: 'canSendToKitchen',
  checkout: 'canCheckoutTable', split: 'canSplitTable', cancel: 'canCancelTable', administer: 'canAdministerTable' };
export const tableAuthorityError = (code = 'RESTAURANT_TABLE_OWNER_REQUIRED') => Object.assign(
  new Error(code === 'RESTAURANT_TABLE_OWNER_REQUIRED'
    ? 'Esta mesa pertenece a otro usuario. Puedes revisar su comanda.'
    : 'No se pudo confirmar el permiso vigente para esta mesa. Actualízala antes de continuar.'), { code });

export const verifyRestaurantTableAuthority = async ({ licenseKey, order, operation,
  actorHandle = actorRuntimeController.capture(), repository = restaurantOrdersRepository } = {}) => {
  actorHandle.assertCurrent(operation === 'cancel' ? 'refunds' : 'pos');
  const response = await repository.getTableCapabilities({ licenseKey, localOrderId: order.id, actorHandle });
  actorHandle.assertCurrent(operation === 'cancel' ? 'refunds' : 'pos');
  if (response?.success !== true || response.contractVersion !== 1 || response.localOrderId !== order.id
    || !response.cloudOrderId || !response.parentVersion) throw tableAuthorityError('RESTAURANT_TABLE_AUTHORITY_UNCONFIRMED');
  const binding = bindRestaurantTableCapabilities(response, actorHandle, order.id);
  const capabilities = getRestaurantTableCapabilities({ order: { ...order, restaurantOrderId: response.cloudOrderId },
    actor: { ...actorHandle, status: 'granted' }, verified: binding });
  if (capabilities[keys[operation]] !== true) throw tableAuthorityError();
  return binding;
};
