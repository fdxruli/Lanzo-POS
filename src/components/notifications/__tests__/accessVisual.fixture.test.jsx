// @vitest-environment jsdom
import { grantTestActor } from '../../../services/auth/__tests__/actorAccessTestHarness';
import { readActorAccess } from '../../../services/auth/actorAccessPolicy';
import { getNotificationAuthorizationKey } from '../../../services/notifications/notificationAccess';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { it, vi } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
const app = vi.hoisted(() => ({ state: null }));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: (selector) => selector(app.state) }));
import NoPermission from '../../common/NoPermission';
import NotificationCenterDrawer from '../NotificationCenterDrawer';
it.skipIf(!process.env.LANZO_ACCESS_VISUAL_DIR)('exports controlled component fixtures for visual inspection', () => {
  const out = process.env.LANZO_ACCESS_VISUAL_DIR;
  mkdirSync(out, { recursive: true });
  const styles = ['src/index.css', 'src/styles/design-tokens.css', 'src/styles/buttons.css', 'src/components/layout/Layout.css', 'src/components/layout/Navbar.css', 'src/components/common/NoPermission.css', 'src/components/notifications/NotificationCenter.css'].map((file) => readFileSync(file, 'utf8')).join('\n').replaceAll(/@import[^;]+;/g, '');
  for (const scenario of ['denied', 'denied-pos', 'restricted', 'connection', 'loading', 'empty']) {
    cleanup();
    grantTestActor({ permissions: { products: true } });
    app.state = { currentDeviceRole: 'staff', currentStaffUser: { id: 'staff-a', permissions: { products: true } }, licenseDetails: { license_key: 'synthetic', features: { notification_center: true, cloud_notifications: true } }, notifications: [], notificationPreferences: {}, supportTickets: [] };
    if (['connection', 'loading', 'empty'].includes(scenario)) {
      grantTestActor({ permissions: { notifications: true } });
      app.state.currentStaffUser.permissions = { notifications: true };
    }
    app.state.notificationAuthorizationKey = getNotificationAuthorizationKey(app.state, readActorAccess(app.state));
    if (scenario === 'connection') app.state.notificationsError = 'No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.';
    if (scenario === 'loading') app.state.notificationsLoading = true;
    const denied = scenario.startsWith('denied');
    render(<MemoryRouter initialEntries={[scenario === 'denied-pos' ? '/' : '/caja']}>
      <div className="app-layout"><div className="content-wrapper">
        <header style={{ minHeight: 56, padding: 16, borderBottom: '1px solid var(--ui-border-color)' }}>LANZO POS · Estado controlado</header>
        <main className={`page-container ${scenario === 'denied-pos' ? 'page-container-pos' : ''}`}>
          {denied ? <NoPermission /> : <NotificationCenterDrawer isOpen onClose={() => {}} />}
        </main>
      </div></div>
      {denied && <nav className="mobile-bottom-nav"><a className="bottom-nav-item" hidden href="/">POS denegado</a><a className="bottom-nav-item" href="/productos">Productos</a><button className="bottom-nav-item">Menú</button></nav>}
    </MemoryRouter>);
    writeFileSync(`${out}/${scenario}.html`, `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>${styles}</style><body>${document.body.innerHTML}</body></html>`);
  }
  cleanup();
});
