import { getDocumentInstanceCoordinator } from '../../../src/services/instance/instanceCoordinator';
import { withFinancialTimeout } from '../../../src/services/financial/financialTimeout';
import { observeFinancialExecution } from '../../../src/services/financial/financialExecutionLifetime';
const coordinator = getDocumentInstanceCoordinator(window);
let resolveTransport, resolveLocal, publicSettled = false, executionSettled = false;
let transportActive = false, localActive = false, execution, dispatchCount = 0;
window.fixture = {
  coordinator,
  snapshot: () => ({ ...coordinator.getSnapshot(), publicSettled, executionSettled, transportActive, localActive, dispatchCount,
    execution: execution?.getSnapshot(), durable: JSON.parse(localStorage.getItem('f012a-synthetic-pending') || 'null') }),
  async begin() {
    // This is synthetic durable evidence, never a server receipt or real sale.
    localStorage.setItem('f012a-synthetic-pending', JSON.stringify({ status: 'PENDING_RECEIPT', key: 'f012a-original-key', hash: 'f012a-original-hash', origin: 'synthetic-actor', attempts: 1 }));
    execution = observeFinancialExecution(scope => withFinancialTimeout(async () => {
      dispatchCount++; transportActive = true;
      await new Promise(done => { resolveTransport = done; }); transportActive = false;
      localActive = true; await new Promise(done => { resolveLocal = done; }); localActive = false;
    }, { timeoutMs: 40, ambiguous: true, executionScope: scope }), coordinator);
    execution.settled.then(() => { executionSettled = true; });
    try { await execution.result; } catch (error) { if (!error.isFinancialTimeout) throw error; }
    finally { publicSettled = true; }
  },
  completeTransport: () => resolveTransport?.(), completeLocal: () => resolveLocal?.(),
  release: () => coordinator.quiesceAndRelease(),
};
void coordinator.start();
