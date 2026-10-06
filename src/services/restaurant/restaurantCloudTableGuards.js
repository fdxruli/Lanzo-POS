// Hydrated tables are snapshots owned by Cloud; this device owns no holds.
// Remote settlement requires a shared atomic normal/split parent contract.
export const isRestaurantCloudTableShadow = (order) => (
    order?.restaurantCloudHydrated === true || order?.reservationAuthority === 'cloud'
);

// Any durable Cloud parent identity must settle through the server financial
// contract, even when this device is the one that originally opened the table.
export const isRestaurantCloudTableSettlementRequired = (order) => Boolean(
    isRestaurantCloudTableShadow(order)
    || order?.cloudRestaurantOrderUpdatedAt
    || order?.restaurantCloudExpectedVersion
    || order?.cloudRestaurantOrderServerVersion
    || order?.restaurantOrderId
    || order?.cloudRestaurantOrderId
);

// Explicit terminal evidence remains authoritative through later outages.
export const isRestaurantCloudTableTerminal = (order) => order?.restaurantCloudTerminalState === 'terminal';

export const restaurantCloudTableTerminalBlockedResult = (order) => ({
  success: false,
  code: order?.restaurantCloudTerminalPaymentStatus === 'paid' ? 'RESTAURANT_ORDER_ALREADY_PAID' : 'RESTAURANT_ORDER_NOT_ACTIVE',
  errorType: order?.restaurantCloudTerminalPaymentStatus === 'paid' ? 'RESTAURANT_ORDER_ALREADY_PAID' : 'RESTAURANT_ORDER_NOT_ACTIVE',
  message: order?.restaurantCloudTerminalPaymentStatus === 'paid'
    ? 'La mesa ya fue cobrada. Actualiza las mesas antes de continuar.'
    : 'La mesa ya fue cerrada. Actualiza las mesas antes de continuar.'
});

export const restaurantCloudTableBlockedResult = (action = 'edit') => ({
  success: false,
  code: action === 'checkout' ? 'CLOUD_TABLE_NORMAL_CHECKOUT_BLOCKED' : 'CLOUD_TABLE_READ_ONLY',
  errorType: action === 'checkout' ? 'CLOUD_TABLE_NORMAL_CHECKOUT_BLOCKED' : 'CLOUD_TABLE_READ_ONLY',
  message: action === 'checkout'
    ? 'Esta mesa puede revisarse aquí. Cóbrala desde el dispositivo de origen.'
    : action === 'cancel'
      ? 'Esta mesa fue creada en otro dispositivo. Actualízala o cancélala desde el dispositivo de origen.'
      : 'Esta mesa fue creada en otro dispositivo. Puedes revisarla; edítala desde el dispositivo de origen.'
});

export const assertRestaurantCloudTableEditable = (order, action = 'edit') => {
  if (isRestaurantCloudTableTerminal(order)) {
    const result = restaurantCloudTableTerminalBlockedResult(order);
    throw Object.assign(new Error(result.message), result);
  }
  if (isRestaurantCloudTableShadow(order)) {
    const result = restaurantCloudTableBlockedResult(action);
    throw Object.assign(new Error(result.message), result);
  }
};
