import Dexie from 'dexie';
import { createRoot } from 'react-dom/client';
import UpdatePrompt from '../../../src/components/common/UpdatePrompt';
import UpdateControls from '../../../src/components/common/UpdateControls';
import { useAppStore } from './store';
import * as worker from '../../../src/pwa/adminServiceWorker';
import * as monitor from '../../../src/pwa/adminServiceWorkerUpdateMonitor';
import { APP_BUILD_ID } from '../../../src/config/appVersion';
import { hasAdminUpdateWrites, installAdminUpdateWriteTracking } from '../../../src/pwa/adminUpdateSafety';
import '../../../src/index.css';
import '../../../src/styles/design-tokens.css';
import '../../../src/styles/buttons.css';
import '../../../src/styles/ui-card.css';

const businessDatabase = new Dexie('update-qa-business');
businessDatabase.version(1).stores({
  session: 'id',
  businesses: 'id',
  customers: 'id,&phoneKey',
  products: 'id',
  sales: 'id',
  customerLedger: 'id',
  outbox: 'id,&idempotencyKey',
  syncMeta: 'id'
});
installAdminUpdateWriteTracking(businessDatabase);

let heldWriteCompletion = null;
const fixtureStores = ['session', 'businesses', 'customers', 'products', 'sales', 'customerLedger', 'outbox', 'syncMeta'];

const persistFixture = async records => {
  await businessDatabase.transaction('rw', fixtureStores, async () => {
    for (const store of fixtureStores) {
      await businessDatabase.table(store).clear();
      await businessDatabase.table(store).bulkPut(records[store] || []);
    }
  });
};

const readFixture = async () => Object.fromEntries(await Promise.all(fixtureStores.map(async store => (
  [store, await businessDatabase.table(store).toArray()]
))));

const beginTrackedWrite = () => {
  heldWriteCompletion = businessDatabase.transaction('rw', 'syncMeta', async () => {
    await businessDatabase.table('syncMeta').put({ id: 'active-write-fixture', state: 'writing' });
    await Dexie.waitFor(new Promise(resolve => window.setTimeout(resolve, 10000)));
    await businessDatabase.table('syncMeta').delete('active-write-fixture');
  });
  return true;
};

window.qa = {
  worker,
  monitor,
  store: useAppStore,
  buildId: APP_BUILD_ID,
  protected: false,
  businessDatabase,
  persistFixture,
  readFixture,
  beginTrackedWrite,
  finishTrackedWrite: async () => {
    try {
      await heldWriteCompletion;
    } catch (error) {
      return { error: String(error), name: error?.name, message: error?.message };
    }
    heldWriteCompletion = null;
  },
  hasTrackedWrite: hasAdminUpdateWrites
};

worker.setAdminServiceWorkerReloadGuard(() => {
  if (window.qa.protected) return 'Termina el cobro de prueba antes de actualizar.';
  if (hasAdminUpdateWrites()) return 'Estamos guardando información. Intenta actualizar en unos momentos.';
  return true;
});
await worker.startAdminServiceWorker();
createRoot(document.getElementById('root')).render(<main>
  <h1>QA aislado del actualizador</h1><p id="build">{APP_BUILD_ID}</p>
  <UpdateControls showApply /><UpdatePrompt />
</main>);
