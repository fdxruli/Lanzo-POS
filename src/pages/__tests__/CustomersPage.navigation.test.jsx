// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const readSource = (relativeUrl) => readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');
const customersPageStyles = readSource('../CustomersPage.css');
const sharedTabsStyles = readSource('../../styles/ui-tabs.css');

const state = vi.hoisted(() => ({
  cloud: true,
  licenseDetails: {
    plan_code: 'pro_monthly',
    features: { cloud_pos_sync: true, customerMessageTemplates: true }
  },
  reminderListCalls: 0
}));

vi.mock('../../components/customers/CustomerForm', () => ({
  default: () => <div data-testid="customer-form">Formulario de agregar cliente</div>
}));

vi.mock('../../components/customers/CustomerList', () => ({
  default: () => <div data-testid="customer-list">Directorio de clientes</div>
}));

vi.mock('../../components/settings/CustomerMessageTemplatesSettings', () => ({
  default: () => <div data-testid="message-config">Configuración de mensajes</div>
}));

vi.mock('../../components/settings/CustomerMessageAutomationSettings', () => ({
  default: () => <div data-testid="reminders-config">Recordatorios y sincronización</div>
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
    cashMode: { online: true }
  })
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: vi.fn((selector) => selector({
    companyProfile: { name: 'Lanzo', settings_default_credit_limit: 100 },
    licenseDetails: state.licenseDetails
  }))
}));

vi.mock('../../services/auth/useActorRuntimeSnapshot', () => ({
  useActorRuntimeSnapshot: () => ({ actorType: 'admin', actorId: 'admin-1' })
}));

vi.mock('../../services/auth/useSettingsAccess', () => ({
  useSettingsAccess: () => ({ actorType: 'admin', isAdmin: true })
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
  getCustomerMessagingLicenseEligibility: () => (state.cloud ? { ok: true } : { ok: false, code: 'CUSTOMER_MESSAGE_CLOUD_UNAVAILABLE' }),
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

const renderPage = (entry) => render(
  <MemoryRouter initialEntries={[entry]}>
    <CustomersPage />
  </MemoryRouter>
);

describe('CustomersPage navigation', () => {
  afterEach(cleanup);

  beforeEach(() => {
    state.cloud = true;
    state.licenseDetails = {
      plan_code: 'pro_monthly',
      features: { cloud_pos_sync: true, customerMessageTemplates: true }
    };
    state.reminderListCalls = 0;
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

  it('shows both cloud tabs for an entitled Pro/Nube session', () => {
    renderPage('/clientes?tab=message-config');
    expect(screen.getByRole('tab', { name: 'Configuración de mensajes' })).toBeInTheDocument();
    expect(screen.getByTestId('message-config')).toBeInTheDocument();

    cleanup();
    renderPage('/clientes?tab=reminders');
    expect(screen.getByRole('tab', { name: 'Recordatorios y sincronización' })).toBeInTheDocument();
    expect(screen.getByTestId('reminders-config')).toBeInTheDocument();
  });

  it('falls back to the list and makes no reminder call for Free/Local', () => {
    state.cloud = false;
    state.licenseDetails = { plan_code: 'free_trial', features: {} };
    renderPage('/clientes?tab=reminders');

    expect(screen.getByRole('tab', { name: 'Lista de clientes' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tab', { name: 'Configuración de mensajes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Recordatorios y sincronización' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('reminders-config')).not.toBeInTheDocument();
    expect(state.reminderListCalls).toBe(0);
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
});
