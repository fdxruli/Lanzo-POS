// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const readSource = (relativeUrl) => readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');
const customersPageStyles = readSource('../CustomersPage.css');
const sharedTabsStyles = readSource('../../styles/ui-tabs.css');

const state = vi.hoisted(() => ({
  cloud: true,
  cloudEligible: true,
  actorAuthorized: true,
  customersPermission: true,
  actorType: 'admin',
  isAdmin: true,
  online: true,
  licenseDetails: {
    valid: true,
    license_key: 'LANZO-QA-PRO',
    plan_code: 'pro_monthly',
    features: { cloud_pos_sync: true, customerMessageTemplates: true }
  },
  reminderListCalls: 0,
  templatesMounts: 0,
  automationMounts: 0
}));

vi.mock('../../components/customers/CustomerForm', () => ({
  default: () => <div data-testid="customer-form">Formulario de agregar cliente</div>
}));

vi.mock('../../components/customers/CustomerList', () => ({
  default: () => <div data-testid="customer-list">Directorio de clientes</div>
}));

vi.mock('../../components/settings/CustomerMessageTemplatesSettings', () => ({
  default: () => {
    state.templatesMounts += 1;
    return <div data-testid="message-config">Editor PRO de mensajes</div>;
  }
}));

vi.mock('../../components/settings/CustomerMessageAutomationSettings', () => ({
  default: () => {
    state.automationMounts += 1;
    return <div data-testid="reminders-config">Recordatorios PRO</div>;
  }
}));

vi.mock('../../components/customers/PurchaseHistoryModal', () => ({ default: () => null }));
vi.mock('../../components/customers/AbonoModal', () => ({ default: () => null }));
vi.mock('../../components/customers/LayawayModal', () => ({ default: () => null }));

vi.mock('../../hooks/useCaja', () => ({
  useCaja: () => ({
    cajaActual: null,
    sincronizarEstadoCaja: vi.fn(),
    isCloudCash: false,
    cashActor: null,
    cashMode: { online: state.online }
  })
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: vi.fn((selector) => selector({
    companyProfile: { name: 'Lanzo', settings_default_credit_limit: 100 },
    licenseDetails: state.licenseDetails,
    appStatus: 'active',
    licenseStatus: 'active',
    currentDeviceRole: state.actorType,
    currentStaffUser: state.actorType === 'staff' ? { id: 'staff-1', permissions: ['customers'] } : null,
    gracePeriodEnds: null
  }))
}));

vi.mock('../../services/auth/useActorRuntimeSnapshot', () => ({
  useActorRuntimeSnapshot: () => ({ actorType: state.actorType, actorId: `${state.actorType}-1` })
}));

vi.mock('../../services/auth/useSettingsAccess', () => ({
  useSettingsAccess: () => ({
    actorType: state.actorType,
    isAdmin: state.isAdmin,
    isAuthorizedActor: state.actorAuthorized,
    canAccessPermission: (permission) => state.customersPermission && permission === 'customers'
  })
}));

vi.mock('../../services/auth/salesPermissionPolicy', () => ({
  canPerformRefunds: () => true,
  getSalesActorIdentity: () => 'admin:admin-1'
}));

vi.mock('../../services/customers/customerRepository', () => ({
  customerRepository: {
    listCustomersPage: vi.fn().mockResolvedValue({
      data: [{ id: 'ruly', name: 'Ruly', debt: 125, creditLimit: 100 }],
      hasMore: false,
      snapshotAt: '2026-09-19T00:00:00.000Z'
    }),
    saveCustomer: vi.fn(),
    deleteCustomer: vi.fn()
  }
}));

vi.mock('../../services/customerCredit/customerCreditRepository', () => ({
  CUSTOMER_CREDIT_CLOUD_OFFLINE_MESSAGE: 'Caja cloud sin conexión.',
  customerCreditRepository: {
    getMode: () => ({ cloudEnabled: false }),
    getCustomerCreditSummary: vi.fn(),
    processPayment: vi.fn()
  }
}));

vi.mock('../../services/customerMessaging', () => ({
  buildAccountStatementMessagePayload: vi.fn(),
  buildPaymentMessagePayload: vi.fn(),
  createFinancialNotificationResult: vi.fn((value) => value),
  formatMoneyValue: (value) => `$${Number(value).toFixed(2)}`,
  getCustomerMessageReminderErrorCopy: (code) => code || 'Error cloud',
  getCustomerMessagingLicenseEligibility: () => (state.cloud
    ? (state.cloudEligible ? { ok: true } : { ok: false, code: 'LICENSE_NOT_ACTIVE' })
    : { ok: false, code: 'CUSTOMER_MESSAGE_CLOUD_UNAVAILABLE' }),
  hasConfirmedPaymentReceipt: vi.fn(),
  isCloudCustomerMessagingEnabled: () => state.cloud,
  listCustomerMessageReminders: vi.fn(async () => {
    state.reminderListCalls += 1;
    return { ok: true, reminders: [], config: { enabled: true } };
  }),
  cancelCustomerMessageReminder: vi.fn(),
  rescheduleCustomerMessageReminder: vi.fn(),
  scheduleCustomerMessageReminder: vi.fn(),
  notificationNotRequested: () => ({ status: 'not_requested' }),
  prepareCustomerMessageOutbox: vi.fn(),
  selectCreditNotes: vi.fn(),
  showCustomerMessageOutboxModal: vi.fn()
}));

vi.mock('../../services/cash/cashRepository', () => ({ cashRepository: { getCurrentCashSession: vi.fn() } }));
vi.mock('../../services/db/dexie', () => ({ db: { table: vi.fn() } }));
vi.mock('../../services/database', () => ({
  DB_ERROR_CODES: { CONSTRAINT_VIOLATION: 'CONSTRAINT_VIOLATION' },
  STORES: { CAJAS: 'cajas', SALES: 'sales', CUSTOMER_LEDGER: 'customer_ledger' },
  loadData: vi.fn().mockResolvedValue([])
}));
vi.mock('../../utils/customerUtils', () => ({
  getSafeCustomerDebt: (value) => Number(value) || 0
}));
vi.mock('../../services/Logger', () => ({ default: { error: vi.fn(), warn: vi.fn() } }));
vi.mock('../../services/utils', () => ({
  showConfirmModal: vi.fn(),
  showMessageModal: vi.fn()
}));

import CustomersPage from '../CustomersPage';

function HistoryControls() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <button type="button" onClick={() => navigate(-1)}>Atrás</button>
      <button type="button" onClick={() => navigate(1)}>Adelante</button>
      <output data-testid="current-search">{location.search}</output>
    </>
  );
}

const renderPage = (entry, { history = false } = {}) => render(
  <MemoryRouter initialEntries={[entry]}>
    {history && <HistoryControls />}
    <CustomersPage />
  </MemoryRouter>
);

describe('CustomersPage navigation', () => {
  afterEach(cleanup);

  beforeEach(() => {
    state.cloud = true;
    state.cloudEligible = true;
    state.actorAuthorized = true;
    state.customersPermission = true;
    state.actorType = 'admin';
    state.isAdmin = true;
    state.online = true;
    state.licenseDetails = {
      valid: true,
      license_key: 'LANZO-QA-PRO',
      plan_code: 'pro_monthly',
      features: { cloud_pos_sync: true, customerMessageTemplates: true }
    };
    state.reminderListCalls = 0;
    state.templatesMounts = 0;
    state.automationMounts = 0;
    vi.clearAllMocks();
  });

  it('defaults to the customer list and keeps metrics compact without the legacy hero', async () => {
    renderPage('/clientes');

    expect(screen.getByRole('tab', { name: 'Lista de clientes' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByTestId('customer-list')).toBeInTheDocument();
    expect(screen.getByText('Fiado total')).toBeInTheDocument();
    expect(screen.getByText('$125.00')).toBeInTheDocument();
    expect(document.querySelector('.customers-hero')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Clientes' })).not.toBeInTheDocument();
    expect(screen.queryByText('Directorio, crédito y mensajería en un solo lugar.')).not.toBeInTheDocument();
  });

  it('uses the shared pill navigation without page overflow or tab icons', () => {
    renderPage('/clientes?tab=list');

    const page = document.querySelector('.customers-page');
    const tabs = page.querySelector('.tabs-container');

    expect(tabs).toHaveClass('tabs-container', 'customers-tabs');
    expect(tabs.querySelectorAll('svg')).toHaveLength(0);
    expect(customersPageStyles).not.toMatch(/\.customers-page \.tabs-container/);
    expect(customersPageStyles).not.toContain('overflow-x: clip');
    expect(sharedTabsStyles).toMatch(/\.customers-page \.tabs-container,[\s\S]*display: flex;/);
    expect(sharedTabsStyles).toMatch(/\.customers-page \.tabs-container,[\s\S]*overflow-x: auto;/);
    expect(sharedTabsStyles).toMatch(/\.customers-page \.tab-btn,[\s\S]*white-space: nowrap;/);
  });

  it('supports the add and list deep links', () => {
    const addView = renderPage('/clientes?tab=add');
    expect(screen.getByRole('tab', { name: 'Agregar cliente' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('customer-form')).toBeInTheDocument();

    addView.unmount();
    renderPage('/clientes?tab=list');
    expect(screen.getByRole('tab', { name: 'Lista de clientes' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('customer-list')).toBeInTheDocument();
  });

  it('falls back safely for an unknown tab without opening a PRO showcase', async () => {
    state.cloud = false;
    state.licenseDetails = { valid: true, license_key: 'LANZO-QA-LOCAL', plan_code: 'free_trial', features: {} };
    renderPage('/clientes?tab=not-a-customer-tab', { history: true });

    expect(screen.getByRole('tab', { name: 'Lista de clientes' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('heading', { name: 'Haz que cada mensaje lleve la identidad de tu negocio' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('current-search')).toHaveTextContent('tab=list'));
  });

  it('shows both cloud tabs for an entitled Pro/Nube session', () => {
    renderPage('/clientes?tab=message-config');
    expect(screen.getByRole('tab', { name: /Configuración de mensajes.*Lanzo Nube PRO/ })).toBeInTheDocument();
    expect(screen.getByTestId('message-config')).toBeInTheDocument();

    cleanup();
    renderPage('/clientes?tab=reminders');
    expect(screen.getByRole('tab', { name: /Recordatorios y sincronización.*Lanzo Nube PRO/ })).toBeInTheDocument();
    expect(screen.getByTestId('reminders-config')).toBeInTheDocument();
  });

  it('shows the message showcase on the direct Local deep link without mounting PRO tools', () => {
    state.cloud = false;
    state.licenseDetails = { valid: true, license_key: 'LANZO-QA-LOCAL', plan_code: 'free_trial', features: {} };
    renderPage('/clientes?tab=message-config');

    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByRole('tab', { name: /Configuración de mensajes.*Lanzo Nube PRO/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Haz que cada mensaje lleve la identidad de tu negocio' })).toBeInTheDocument();
    expect(screen.getByText(/Lanzo Local conserva su forma manual y genérica/)).toBeInTheDocument();
    expect(screen.queryByTestId('message-config')).not.toBeInTheDocument();
    expect(state.templatesMounts).toBe(0);
    expect(state.automationMounts).toBe(0);
    expect(state.reminderListCalls).toBe(0);
  });

  it('shows the reminders showcase for Local and makes no Cloud reminder calls', () => {
    state.cloud = false;
    state.licenseDetails = { valid: true, license_key: 'LANZO-QA-LOCAL', plan_code: 'free_trial', features: {} };
    renderPage('/clientes?tab=reminders');

    expect(screen.getByRole('tab', { name: /Recordatorios y sincronización.*Lanzo Nube PRO/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Organiza el seguimiento de tus cuentas por cobrar' })).toBeInTheDocument();
    expect(screen.getByText(/La entrega depende de los mecanismos de envío disponibles/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Conocer Lanzo Nube/ })).toHaveAttribute('href', '/acerca-de');
    expect(state.reminderListCalls).toBe(0);
    expect(state.automationMounts).toBe(0);
  });

  it('loads the list reminder state once without mounting global automation twice', async () => {
    renderPage('/clientes?tab=list');
    await waitFor(() => expect(state.reminderListCalls).toBe(1));
  });

  it('changes the deep link when a user selects another tab', () => {
    renderPage('/clientes?tab=list');
    fireEvent.click(screen.getByRole('tab', { name: 'Agregar cliente' }));
    expect(screen.getByTestId('customer-form')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Agregar cliente' })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps tab and panel ids aligned and supports Back and Forward between tabs', () => {
    renderPage('/clientes?tab=list', { history: true });
    fireEvent.click(screen.getByRole('tab', { name: 'Agregar cliente' }));
    fireEvent.click(screen.getByRole('tab', { name: /Configuración de mensajes/ }));

    for (const tab of screen.getAllByRole('tab')) {
      const panel = document.getElementById(tab.getAttribute('aria-controls'));
      expect(panel).toHaveAttribute('aria-labelledby', tab.id);
    }
    expect(screen.getByTestId('current-search')).toHaveTextContent('tab=message-config');

    fireEvent.click(screen.getByRole('button', { name: 'Atrás' }));
    expect(screen.getByRole('tab', { name: 'Agregar cliente' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Adelante' }));
    expect(screen.getByRole('tab', { name: /Configuración de mensajes/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('moves tabs with the keyboard and keeps only the active tab in the tab sequence', () => {
    state.cloud = false;
    state.licenseDetails = { valid: true, license_key: 'LANZO-QA-LOCAL', plan_code: 'free_trial', features: {} };
    renderPage('/clientes?tab=add');

    const addTab = screen.getByRole('tab', { name: 'Agregar cliente' });
    expect(addTab).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(addTab, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Lista de clientes' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Agregar cliente' })).toHaveAttribute('tabindex', '-1');
  });

  it('keeps Local tabs and tools when returning from a showcase', async () => {
    state.cloud = false;
    state.licenseDetails = { valid: true, license_key: 'LANZO-QA-LOCAL', plan_code: 'free_trial', features: {} };
    renderPage('/clientes?tab=message-config');

    fireEvent.click(screen.getByRole('tab', { name: 'Lista de clientes' }));
    expect(await screen.findByTestId('customer-list')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Agregar cliente' }));
    expect(screen.getByTestId('customer-form')).toBeInTheDocument();
  });

  it('replaces the showcase with the real module on PRO upgrade and preserves the real editor offline', () => {
    const view = renderPage('/clientes?tab=message-config');
    expect(screen.getByTestId('message-config')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Haz que cada mensaje lleve la identidad de tu negocio' })).not.toBeInTheDocument();

    state.cloud = false;
    state.licenseDetails = { valid: true, license_key: 'LANZO-QA-LOCAL', plan_code: 'free_trial', features: {} };
    view.rerender(<MemoryRouter initialEntries={['/clientes?tab=message-config']}><CustomersPage /></MemoryRouter>);
    expect(screen.queryByTestId('message-config')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Haz que cada mensaje lleve la identidad de tu negocio' })).toBeInTheDocument();

    state.cloud = true;
    state.licenseDetails = { valid: true, license_key: 'LANZO-QA-PRO', plan_code: 'pro_monthly', features: { cloud_pos_sync: true, customerMessageTemplates: true } };
    state.online = false;
    view.rerender(<MemoryRouter initialEntries={['/clientes?tab=message-config']}><CustomersPage /></MemoryRouter>);
    expect(screen.getByTestId('message-config')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Haz que cada mensaje lleve la identidad de tu negocio' })).not.toBeInTheDocument();
  });

  it('does not turn a missing actor authorization into a commercial showcase or Cloud tools', () => {
    state.cloud = false;
    state.actorAuthorized = false;
    state.licenseDetails = { valid: true, license_key: 'LANZO-QA-LOCAL', plan_code: 'free_trial', features: {} };
    renderPage('/clientes?tab=message-config');
    expect(screen.queryByRole('tab', { name: /Configuración de mensajes/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Haz que cada mensaje lleve la identidad de tu negocio' })).not.toBeInTheDocument();

    cleanup();
    state.cloud = true;
    state.licenseDetails = { valid: true, license_key: 'LANZO-QA-PRO', plan_code: 'pro_monthly', features: { cloud_pos_sync: true, customerMessageTemplates: true } };
    renderPage('/clientes?tab=message-config');
    expect(screen.queryByTestId('message-config')).not.toBeInTheDocument();
    expect(state.templatesMounts).toBe(0);
  });

  it('does not show a showcase for an inactive Local license or a PRO authority error', () => {
    state.cloud = false;
    state.licenseDetails = {
      valid: true,
      license_key: 'LANZO-QA-LOCAL',
      plan_code: 'free_trial',
      lifecycle_state: 'revoked',
      features: {}
    };
    renderPage('/clientes?tab=message-config');
    expect(screen.queryByRole('tab', { name: /Configuración de mensajes/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Haz que cada mensaje lleve la identidad de tu negocio' })).not.toBeInTheDocument();

    cleanup();
    state.cloud = true;
    state.cloudEligible = false;
    state.licenseDetails = { valid: true, license_key: 'LANZO-QA-PRO', plan_code: 'pro_monthly', features: { cloud_pos_sync: true, customerMessageTemplates: true } };
    renderPage('/clientes?tab=message-config');
    expect(screen.getByTestId('message-config')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Haz que cada mensaje lleve la identidad de tu negocio' })).not.toBeInTheDocument();
  });

  it('allows an authorized Staff member to discover the feature without mounting PRO tools', () => {
    state.cloud = false;
    state.actorType = 'staff';
    state.isAdmin = false;
    state.licenseDetails = { valid: true, license_key: 'LANZO-QA-LOCAL', plan_code: 'free_trial', device_role: 'staff', features: {} };
    renderPage('/clientes?tab=reminders');

    expect(screen.getByRole('heading', { name: 'Organiza el seguimiento de tus cuentas por cobrar' })).toBeInTheDocument();
    expect(state.automationMounts).toBe(0);
    expect(state.reminderListCalls).toBe(0);
  });

  it('keeps the Acerca de CTA informational and leaves the license unchanged', () => {
    state.cloud = false;
    state.licenseDetails = { valid: true, license_key: 'LANZO-QA-LOCAL', plan_code: 'free_trial', features: {} };
    const licenseBefore = state.licenseDetails;
    renderPage('/clientes?tab=message-config');

    expect(screen.getByRole('link', { name: /Conocer Lanzo Nube/ })).toHaveAttribute('href', '/acerca-de');
    expect(state.licenseDetails).toBe(licenseBefore);
  });
});
