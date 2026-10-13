export const RESTAURANT_CLIENT_CONTRACT_VERSION = 2;
export const RESTAURANT_UPGRADE_MESSAGE = 'Hay una actualización disponible para continuar gestionando esta mesa. Tus datos locales se conservarán.';
export const restaurantContractError = (code = 'RESTAURANT_CLIENT_UPGRADE_REQUIRED') => Object.assign(
  new Error(code === 'RESTAURANT_CONTRACT_MAINTENANCE'
    ? 'La gestión de mesas está en una actualización programada. Tus datos locales se conservarán. Si estabas cobrando, verifica el resultado antes de reintentar.'
    : RESTAURANT_UPGRADE_MESSAGE), { code, restaurantContractError: true });

// These are server descriptions, never individual operation grants. Discovery
// is deliberately not persisted/cached across actor, tenant, tab or reconnect.
export const normalizeRestaurantCloudContract = (response) => {
  const absent = { supported: false, endpointAvailable: false, contractVersion: 0,
    adminSupervisionAvailable: false, versionedWritesAvailable: false, legacyWritesAllowed: false };
  if (!response) return absent;
  const version = response.contractVersion;
  const minimum = response.minimumSupportedClientVersion;
  const supported = response.success === true && [1, 2].includes(version)
    && Number.isInteger(minimum) && minimum >= 1 && minimum <= RESTAURANT_CLIENT_CONTRACT_VERSION
    && response.versionedWritesAvailable === true && response.versionedParentVersionRequired === true
    && response.kitchenTerminalGuardEnabled === true
    && typeof response.strictParentVersionRequired === 'boolean'
    && typeof response.writesPaused === 'boolean' && typeof response.legacyWritesAllowed === 'boolean'
    && typeof response.adminSupervisionAvailable === 'boolean'
    && typeof response.serverCapabilityGeneration === 'string' && response.serverCapabilityGeneration.length > 0
    && (version !== 2 || (response.strictParentVersionRequired === true && response.legacyWritesAllowed === false))
    && (!response.adminSupervisionAvailable || version === 2);
  return { ...absent, ...response, endpointAvailable: true, supported,
    adminSupervisionAvailable: supported && version === 2 && response.adminSupervisionAvailable === true };
};

export const assertRestaurantCloudContract = (contract, { mutation = false } = {}) => {
  if (contract?.supported !== true) throw restaurantContractError();
  if (mutation && contract.writesPaused) throw restaurantContractError('RESTAURANT_CONTRACT_MAINTENANCE');
  return contract;
};

export const isRestaurantContractFailure = (error) => error?.restaurantContractError === true
  || /RESTAURANT_CLIENT_UPGRADE_REQUIRED|RESTAURANT_CONTRACT_(MAINTENANCE|UNSUPPORTED)|RESTAURANT_ADMIN_SUPERVISION_NOT_ACTIVE|RESTAURANT_ORDER_VERSION_(CONFLICT|REQUIRED)|PGRST202/.test(
    `${error?.code || ''} ${error?.message || ''} ${error?.cause?.message || ''} ${error?.originalError?.code || ''} ${error?.originalError?.message || ''}`);
