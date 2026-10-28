import { getDocumentInstanceCoordinator } from '../../../src/services/instance/instanceCoordinator';
import { withFinancialTimeout } from '../../../src/services/financial/financialTimeout';

const coordinator = getDocumentInstanceCoordinator(window);
let resolveNative;
let nativeActive = false;
let publicSettled = false;
let trackedNativeSettled = false;
let failure = null;
let nativeWork;
const snapshot = () => ({ ...coordinator.getSnapshot(), nativeActive, publicSettled, trackedNativeSettled, failure });
window.fixture = {
  coordinator, snapshot,
  async begin(trackRaw) {
    coordinator.captureTicket();
    nativeActive = true;
    nativeWork = new Promise(done => { resolveNative = done; }).then(() => {
      nativeActive = false;
    });
    // This path is a proposal harness only. Actual financial APIs do not expose
    // this native-work reference. It is not wired into any business module.
    if (trackRaw) coordinator.runExecutor(() => nativeWork)
      .catch(error => { failure = error.code; })
      .finally(() => { trackedNativeSettled = true; });
    try {
      await coordinator.runExecutor(() => withFinancialTimeout(nativeWork, { timeoutMs: 40, ambiguous: true }));
    } catch (error) {
      failure = error.code;
    } finally { publicSettled = true; }
  },
  completeNative: () => resolveNative?.(),
  release: () => coordinator.quiesceAndRelease(),
};
void coordinator.start();
