import Logger from '../Logger';
import { customerCreditSyncHandler } from '../customerCredit/customerCreditSyncHandler';
import { shouldDeferPosBootstrapStartHook } from './syncConstants';

let patched = false;

export const installPosSyncDeferredStartPatches = () => {
  if (patched) return false;

  const originalCreditOnStart = customerCreditSyncHandler.onStart.bind(customerCreditSyncHandler);

  customerCreditSyncHandler.onStart = async (context = {}) => {
    if (shouldDeferPosBootstrapStartHook(context.reason, { force: context.force === true })) {
      Logger.log('[CustomerCredit/Sync] Snapshot inicial diferido por bootstrap inteligente.');
      return { skipped: true, deferred: true, reason: 'bootstrap_deferred_snapshot' };
    }

    return originalCreditOnStart(context);
  };

  patched = true;
  return true;
};

installPosSyncDeferredStartPatches();

export default installPosSyncDeferredStartPatches;
