// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AboutPage from '../AboutPage';

const state = vi.hoisted(() => ({ store: null, actor: null, settings: null }));
vi.mock('../../store/useAppStore', () => ({ useAppStore: (selector) => selector(state.store) }));
vi.mock('../../services/auth/useActorRuntimeSnapshot', () => ({ useActorRuntimeSnapshot: () => state.actor }));
vi.mock('../../services/auth/useSettingsAccess', () => ({ useSettingsAccess: () => state.settings }));
vi.mock('../../components/common/Logo', () => ({ default: () => <span aria-hidden="true">Lanzo</span> }));

const renderPage = () => render(<MemoryRouter><AboutPage /></MemoryRouter>);
const planRegion = () => screen.getByRole('region', { name: 'Lanzo Local' });
const capabilities = () => screen.getByRole('region', { name: 'Todo lo que puedes hacer con Lanzo' });

describe('AboutPage confirmed Local experience', () => {
  beforeEach(() => {
    state.store = {
      licenseDetails: {
        plan_code: 'free_trial', valid: true, status: 'active', max_devices: 1,
        features: {
          cloud_pos_sync: false, staff_roles: false, ai_agents: false,
          local_inventory_alerts: true, ecommerce_portal_enabled: true,
          ecommerce_max_published_products: 10, ecommerce_business_hours: true,
          ecommerce_whatsapp_checkout: true, ecommerce_order_inbox: true
        }
      },
      licenseStatus: 'active', companyProfile: { name: 'Negocio QA', business_type: ['farmacia'] },
      canAccess: () => true, currentDeviceRole: 'admin'
    };
    state.actor = { status: 'granted', actorType: 'admin', actorId: 'qa', sessionId: 'qa-session', permissions: ['*'] };
    state.settings = { isAuthorizedActor: true, isAdmin: true, actorType: 'admin', canEnterSettings: true };
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('QA-01/02 identifies the current plan independently and orders all five areas', () => {
    renderPage();
    expect(planRegion()).toHaveTextContent('Tu plan actual');
    expect(within(planRegion()).getByText('Activo')).toBeVisible();
    expect(within(planRegion()).getByText('$0 MXN')).toBeVisible();
    const order = [
      planRegion(), capabilities(),
      screen.getByRole('region', { name: 'Elige a tu ritmo' }),
      screen.getByRole('region', { name: 'Cuando tu negocio crezca, Lanzo también crecerá contigo' }),
      screen.getByRole('region', { name: 'Historia y ayuda' })
    ];
    order.slice(1).forEach((element, index) => {
      expect(order[index].compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
    expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(2);
    expect(screen.queryByRole('button', { pressed: true })).not.toBeInTheDocument();
    expect(screen.queryByText(/OFERTA DE LANZAMIENTO|3 meses por/)).not.toBeInTheDocument();
  });

  it('QA-03 lists real local areas and only safe specialized tools', () => {
    renderPage();
    ['Punto de venta', 'Productos e inventario', 'Caja y control diario', 'Clientes', 'Ventas y reportes', 'Tienda en línea', 'Datos y respaldos', 'Para tu tipo de negocio'].forEach(name => {
      expect(within(capabilities()).getByRole('heading', { name, level: 3 })).toBeVisible();
    });
    expect(capabilities()).toHaveTextContent('Control por lotes, seguimiento de caducidades');
    expect(capabilities()).toHaveTextContent('alertas locales de inventario');
    expect(capabilities()).toHaveTextContent('Requiere conexión a internet');
    expect(capabilities()).not.toHaveTextContent(/Agentes|Roles|respaldo cloud|laboratorio|recetas|modificadores|variantes/i);
  });

  it('QA-03 respects disabled flags and the report permission', () => {
    state.store.licenseDetails.features = { cloud_pos_sync: false };
    state.store.companyProfile.business_type = ['desconocido'];
    state.actor = { status: 'resolving' };
    renderPage();
    expect(within(capabilities()).queryByRole('heading', { name: 'Tienda en línea' })).not.toBeInTheDocument();
    expect(within(capabilities()).queryByRole('heading', { name: 'Para tu tipo de negocio' })).not.toBeInTheDocument();
    expect(capabilities()).not.toHaveTextContent('alertas locales de inventario');
    expect(capabilities()).toHaveTextContent('Pide al administrador que revise tu acceso');
  });

  it.each([
    [3, 4, '3 dispositivos', 'Hasta 4 productos publicados'],
    [2, 0, '2 dispositivos', 'no permite publicar productos'],
    [1, -1, '1 dispositivo', 'Productos publicados sin límite'],
    [null, null, 'Según licencia', 'según el límite de tu licencia'],
    [false, false, 'Según licencia', 'según el límite de tu licencia'],
    ['invalid', 'invalid', 'Según licencia', 'según el límite de tu licencia']
  ])('QA-04 uses effective limits %s / %s without static promises', (devices, products, expectedDevices, expectedProducts) => {
    state.store.licenseDetails.max_devices = devices;
    state.store.licenseDetails.features.ecommerce_max_published_products = products;
    renderPage();
    expect(planRegion()).toHaveTextContent(expectedDevices);
    expect(capabilities()).toHaveTextContent(expectedProducts);
  });

  it('QA-04 reads nested features and honors the effective override', () => {
    const features = { ...state.store.licenseDetails.features, max_devices: 2, ecommerce_max_published_products: 7 };
    delete state.store.licenseDetails.features;
    state.store.licenseDetails.details = { features };
    renderPage();
    expect(planRegion()).toHaveTextContent('2 dispositivos');
    expect(capabilities()).toHaveTextContent('Hasta 7 productos publicados');
  });

  it('QA-03 omits disabled ecommerce subfeatures without hiding the portal', () => {
    Object.assign(state.store.licenseDetails.features, { ecommerce_business_hours: false, ecommerce_whatsapp_checkout: false, ecommerce_order_inbox: false });
    renderPage();
    const online = within(capabilities()).getByRole('heading', { name: 'Tienda en línea' }).closest('article');
    expect(online).toHaveTextContent('Hasta 10 productos publicados');
    expect(online).not.toHaveTextContent(/Horarios comerciales|WhatsApp|Gestión de pedidos/);
  });

  it('QA-05/06/11 supports keyboard selection, live recommendations, preview and focus restoration', async () => {
    const user = userEvent.setup();
    const initialLicense = structuredClone(state.store.licenseDetails);
    renderPage();
    await user.tab();
    const solo = screen.getByRole('button', { name: /Vendo desde un equipo/ });
    expect(solo).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(solo).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Puedes seguir con tu plan actual');
    const keep = screen.getByRole('link', { name: /Mantener plan Local/ });
    expect(keep).toHaveAttribute('href', '#about-local-plan');
    expect(document.querySelector(keep.getAttribute('href'))).toBe(planRegion());
    await user.tab();
    await user.keyboard(' ');
    expect(screen.getByRole('button', { name: /Trabajo con un equipo/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Lanzo Nube para trabajar en equipo');
    await user.tab();
    const request = screen.getByRole('button', { name: 'Solicitar Lanzo Nube' });
    expect(request).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog')).toHaveTextContent('Revisa el mensaje antes de continuar');
    await user.keyboard('{Escape}');
    expect(request).toHaveFocus();
    expect(state.store.licenseDetails).toEqual(initialLicense);
  });

  it('QA-06 does not expose commercial actions to a resolving actor or staff', async () => {
    state.settings = { isAuthorizedActor: false, isAdmin: false };
    state.actor = { status: 'resolving' };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Trabajo con un equipo/ }));
    expect(screen.getByRole('button', { name: 'Contactar soporte' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Solicitar Lanzo Nube|Consultar requisitos/ })).not.toBeInTheDocument();
  });

  it.each(['pending', 'unknown', 'expired', 'invalid', 'grace_period'])('QA-08/09 excludes Free for an unconfirmed Local status: %s', (status) => {
    state.store.licenseStatus = status;
    Object.assign(state.store.licenseDetails, { status, valid: false });
    renderPage();
    expect(screen.queryByRole('region', { name: 'Lanzo Local' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Todo lo que puedes hacer con Lanzo' })).not.toBeInTheDocument();
    expect(screen.queryByText('Activo')).not.toBeInTheDocument();
  });

  it('QA-10 renders from valid cached license data offline without a remote query', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Offline'));
    renderPage();
    expect(planRegion()).toHaveTextContent('Activo');
    expect(capabilities()).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
