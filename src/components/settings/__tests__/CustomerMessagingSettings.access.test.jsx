// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  actorType: 'admin',
  isAdmin: true,
  cloud: true,
  licenseDetails: {
    plan_code: 'pro_monthly',
    features: { cloud_pos_sync: true, customerMessageTemplates: true }
  },
  actionGuard: vi.fn(() => ({ actorType: 'admin', assertCurrent: vi.fn() })),
  templateListCalls: 0,
  reminderListCalls: 0
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: vi.fn((selector) => selector({
    licenseDetails: state.licenseDetails
  }))
}));

vi.mock('../../../services/auth/useSettingsAccess', () => ({
  useSettingsAccess: () => ({ actorType: state.actorType, isAdmin: state.isAdmin }),
  useSettingsActionGuard: () => state.actionGuard
}));

vi.mock('../../../utils/planDisplay', () => ({ getCommercialPlanName: () => 'Pro' }));
vi.mock('../../../services/utils', () => ({ showConfirmModal: vi.fn().mockResolvedValue(true) }));

vi.mock('../../../services/customerMessaging', () => ({
  CUSTOMER_MESSAGE_EVENT_TYPES: ['sale_paid'],
  CUSTOMER_MESSAGE_CLOUD_OUTBOX_STATUS_LABELS: {},
  CUSTOMER_MESSAGE_REMINDER_DEFAULTS: {
    enabled: true,
    timeZone: 'America/Mexico_City',
    localTime: '09:00',
    maxAttempts: 3,
    backoffMinutes: 30
  },
  CUSTOMER_MESSAGE_REMINDER_STATUS_LABELS: { programado: 'Programado' },
  buildCustomerMessageTemplatePreviewPayload: () => ({ ok: true }),
  canManageCustomerMessageTemplates: () => state.isAdmin,
  cancelCustomerMessageReminder: vi.fn(),
  getCustomerMessageReminderErrorCopy: (code) => code || 'Error cloud',
  getCustomerMessagingLicenseEligibility: () => (state.cloud ? { ok: true } : { ok: false, code: 'CUSTOMER_MESSAGE_CLOUD_UNAVAILABLE' }),
  getDefaultCustomerMessageTemplate: () => ({ title: 'Título', body: 'Cuerpo', footer: 'Pie' }),
  getTemplateVariablesForEvent: () => [],
  isCloudCustomerMessagingEnabled: () => state.cloud,
  listCustomerMessageReminders: vi.fn(async () => {
    state.reminderListCalls += 1;
    return { ok: true, reminders: [], config: { enabled: true } };
  }),
  listCustomerMessageTemplates: vi.fn(async () => {
    state.templateListCalls += 1;
    return { ok: true, templates: [] };
  }),
  renderCustomerMessageImage: vi.fn(),
  resetCustomerMessageTemplate: vi.fn(),
  rescheduleCustomerMessageReminder: vi.fn(),
  saveCustomerMessageReminderConfig: vi.fn(),
  saveCustomerMessageTemplate: vi.fn(),
  syncCustomerMessageOutbox: vi.fn().mockResolvedValue({ ok: true, records: [] }),
  validateCustomerMessageTemplate: () => ({ ok: true, errors: [] })
}));

import CustomerMessageTemplatesSettings from '../CustomerMessageTemplatesSettings';
import CustomerMessageAutomationSettings from '../CustomerMessageAutomationSettings';

describe('customer messaging settings access', () => {
  afterEach(cleanup);

  beforeEach(() => {
    state.actorType = 'admin';
    state.isAdmin = true;
    state.cloud = true;
    state.templateListCalls = 0;
    state.reminderListCalls = 0;
    vi.clearAllMocks();
  });

  it('allows an Admin to edit templates and reminder configuration', async () => {
    render(
      <>
        <CustomerMessageTemplatesSettings />
        <CustomerMessageAutomationSettings />
      </>
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled());
    expect(screen.getByLabelText('Activar recordatorios cloud')).toBeEnabled();
    await waitFor(() => expect(state.reminderListCalls).toBe(1));
  });

  it('keeps Staff read-only and avoids loading editable templates', async () => {
    state.actorType = 'staff';
    state.isAdmin = false;

    render(
      <>
        <CustomerMessageTemplatesSettings />
        <CustomerMessageAutomationSettings />
      </>
    );

    expect(screen.queryByRole('button', { name: 'Guardar', exact: true })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Activar recordatorios cloud')).toBeDisabled();
    expect(screen.getByText(/Staff puede consultar estados/i)).toBeInTheDocument();
    expect(state.templateListCalls).toBe(0);
    await waitFor(() => expect(state.reminderListCalls).toBe(1));
  });

  it('does not mount cloud automation for Local/Free', () => {
    state.cloud = false;
    render(<CustomerMessageAutomationSettings />);
    expect(screen.queryByLabelText('Activar recordatorios cloud')).not.toBeInTheDocument();
    expect(state.reminderListCalls).toBe(0);
  });
});
