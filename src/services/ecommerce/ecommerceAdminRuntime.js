let getStoreState = () => ({});
let adminReadApi = null;

export const bindEcommerceAdminStoreState = (getState) => {
  if (typeof getState !== 'function') {
    throw new TypeError('ECOMMERCE_ADMIN_STORE_READER_REQUIRED');
  }
  getStoreState = getState;
};

export const getEcommerceAdminStoreState = () => {
  try {
    const state = getStoreState();
    return state && typeof state === 'object' ? state : {};
  } catch {
    return {};
  }
};

export const bindEcommerceAdminReadApi = (api) => {
  if (
    !api
    || typeof api.getEcommercePortal !== 'function'
    || typeof api.listPublishedProducts !== 'function'
  ) {
    throw new TypeError('ECOMMERCE_ADMIN_READ_API_REQUIRED');
  }
  adminReadApi = api;
};

export const getEcommerceAdminReadApi = () => adminReadApi;
