const ecommerceCheckoutInitiations = new Map();

const normalizeOrderId = (orderId) => (
  typeof orderId === 'string' ? orderId.trim() : ''
);

export const getEcommerceCheckoutInitiation = (orderId) => (
  ecommerceCheckoutInitiations.get(normalizeOrderId(orderId)) || null
);

export const clearEcommerceCheckoutInitiationIfOwned = (orderId, token) => {
  const normalizedOrderId = normalizeOrderId(orderId);
  const current = ecommerceCheckoutInitiations.get(normalizedOrderId);
  if (!current || current.token !== token) return false;

  ecommerceCheckoutInitiations.delete(normalizedOrderId);
  return true;
};

export const runEcommerceCheckoutInitiationSingleFlight = ({
  orderId,
  onStart,
  run,
  onSettled
} = {}) => {
  const normalizedOrderId = normalizeOrderId(orderId);
  if (!normalizedOrderId) {
    return Promise.reject(new Error('ECOMMERCE_CHECKOUT_ORDER_ID_REQUIRED'));
  }
  if (typeof run !== 'function') {
    return Promise.reject(new Error('ECOMMERCE_CHECKOUT_RUN_REQUIRED'));
  }

  const existing = ecommerceCheckoutInitiations.get(normalizedOrderId);
  if (existing) return existing.promise;

  const token = Symbol(normalizedOrderId);
  let releaseStart;
  let rejectStart;
  const startSignal = new Promise((resolve, reject) => {
    releaseStart = resolve;
    rejectStart = reject;
  });

  const operationPromise = startSignal.then(() => run({
    orderId: normalizedOrderId,
    token
  }));

  const sharedPromise = operationPromise.finally(() => {
    if (!clearEcommerceCheckoutInitiationIfOwned(normalizedOrderId, token)) return;

    try {
      onSettled?.({ orderId: normalizedOrderId, token });
    } catch (error) {
      console.error('[ecommerceCheckoutSingleFlight] Error al limpiar el estado visual:', error);
    }
  });

  ecommerceCheckoutInitiations.set(normalizedOrderId, {
    token,
    promise: sharedPromise
  });

  try {
    onStart?.({ orderId: normalizedOrderId, token });
    releaseStart();
  } catch (error) {
    rejectStart(error);
  }

  return sharedPromise;
};

const resetEcommerceCheckoutInitiations = () => {
  ecommerceCheckoutInitiations.clear();
};

export const ecommerceCheckoutInitiationSingleFlightInternals = Object.freeze({
  normalizeOrderId,
  resetEcommerceCheckoutInitiations
});
