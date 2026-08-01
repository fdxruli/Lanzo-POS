let resetHandler = null;

export const registerPosCatalogSessionResetHandler = (handler) => {
  resetHandler = typeof handler === 'function' ? handler : null;
};

export const notifyPosCatalogSessionReset = () => {
  resetHandler?.();
};
