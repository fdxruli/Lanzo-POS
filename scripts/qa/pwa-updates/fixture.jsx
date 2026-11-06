import { createRoot } from 'react-dom/client';
import UpdatePrompt from '../../../src/components/common/UpdatePrompt';
import UpdateControls from '../../../src/components/common/UpdateControls';
import { useAppStore } from './store';
import * as worker from '../../../src/pwa/adminServiceWorker';
import * as monitor from '../../../src/pwa/adminServiceWorkerUpdateMonitor';
import { APP_BUILD_ID } from '../../../src/config/appVersion';
import '../../../src/styles/design-tokens.css';
import '../../../src/styles/buttons.css';
import '../../../src/styles/ui-card.css';
window.qa = { worker, monitor, store: useAppStore, buildId: APP_BUILD_ID, protected: false };
worker.setAdminServiceWorkerReloadGuard(() => window.qa.protected ? 'Termina el cobro de prueba antes de actualizar.' : true);
await worker.startAdminServiceWorker();
createRoot(document.getElementById('root')).render(<main>
  <h1>QA aislado del actualizador</h1><p id="build">{APP_BUILD_ID}</p>
  <UpdateControls showApply /><UpdatePrompt />
</main>);
