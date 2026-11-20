const lockNameForLicense = (licenseKey) => {
  let hash = 2166136261;
  for (const character of String(licenseKey || '')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `lanzo:product-catalog-recovery:${(hash >>> 0).toString(16)}`;
};

export const runWithProductCatalogRecoveryLock = async ({
  licenseKey,
  requireWebLock = false,
  operation
} = {}) => {
  if (!licenseKey || typeof operation !== 'function') {
    throw Object.assign(new Error('PRODUCT_RECOVERY_CONTEXT_REQUIRED'), {
      code: 'PRODUCT_RECOVERY_CONTEXT_REQUIRED'
    });
  }

  const lockManager = globalThis.navigator?.locks;
  if (typeof lockManager?.request !== 'function') {
    if (requireWebLock) {
      throw Object.assign(new Error('PRODUCT_RECOVERY_LOCK_UNAVAILABLE'), {
        code: 'PRODUCT_RECOVERY_LOCK_UNAVAILABLE'
      });
    }
    return operation({ licenseKey, locked: false });
  }

  return lockManager.request(lockNameForLicense(licenseKey), { mode: 'exclusive' }, async (lock) => {
    if (!lock) {
      throw Object.assign(new Error('PRODUCT_RECOVERY_LOCK_UNAVAILABLE'), {
        code: 'PRODUCT_RECOVERY_LOCK_UNAVAILABLE'
      });
    }
    return operation({ licenseKey, locked: true });
  });
};

export default runWithProductCatalogRecoveryLock;
