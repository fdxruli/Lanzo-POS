// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const TICKET_ID = '123e4567-e89b-42d3-a456-426614174000';
const CORRELATION_ID = `financial:v1:${'a'.repeat(40)}`;

const fixtures = vi.hoisted(() => ({
  list: vi.fn(), summary: vi.fn(), getDiagnostic: vi.fn(), receipt: vi.fn(), projection: vi.fn(),
  listTickets: vi.fn(), actorChanged: false, tenantChanged: false,
  mode: null,
  actorAccess: null,
  store: null
}));

vi.mock('../../../../services/cash/cashActor', () => ({
  getCashMode: () => fixtures.mode
}));
vi.mock('../../../../services/auth/useActorAccess', () => ({
  useActorAccess: () => fixtures.actorAccess
}));
vi.mock('../../../../services/auth/useActorRuntimeSnapshot', () => ({
  useActorRuntimeSnapshot: () => fixtures.actorAccess?.runtimeSnapshot || {}
}));
vi.mock('../../../../services/auth/actorRuntimeController', () => ({
  actorRuntimeController: {
    capture: () => ({
      assertCurrent: () => {
        if (fixtures.actorChanged || fixtures.tenantChanged) throw new Error('ACTOR_CONTEXT_CHANGED');
      }
    })
  }
}));
vi.mock('../../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector(fixtures.store)
}));
vi.mock('../../../../services/financial/financialIntentObservability', () => ({
  listFinancialIntentDiagnostics: (...args) => fixtures.list(...args),
  getFinancialDiagnosticSummary: (...args) => fixtures.summary(...args),
  getFinancialIntentDiagnostic: (...args) => fixtures.getDiagnostic(...args)
}));
vi.mock('../../../../services/financial/financialReceiptReconciliation', () => ({ refreshFinancialIntentReceipt: (...args) => fixtures.receipt(...args) }));
vi.mock('../../../../services/financial/financialProjectionRepair', () => ({ retryFinancialIntentProjection: (...args) => fixtures.projection(...args) }));
vi.mock('../../../../services/support/supportTicketService', () => ({
  listSupportTickets: (...args) => fixtures.listTickets(...args)
}));
vi.mock('../../../../services/financial/financialIntentDiagnostics', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    buildFinancialDiagnosticText: (diagnostic) => `Intent: ${diagnostic.intentId}\nEstado: ${diagnostic.financialStatus}`
  };
});

import FinancialDiagnosticsPanel from '../FinancialDiagnosticsPanel';

afterEach(() => cleanup());
beforeEach(() => {
  vi.clearAllMocks();
  fixtures.actorChanged = false;
  fixtures.tenantChanged = false;
  fixtures.mode = {
    cloudEnabled: true,
    licenseKey: 'transient-only',
    licenseDetails: { tenant_opaque_id: 'tenant-a' },
    actor: { actorKey: 'admin:a', isStaff: false }
  };
  fixtures.actorAccess = {
    isAuthorizedActor: true,
    isAdmin: true,
    actorType: 'admin',
    actorId: 'admin-a',
    runtimeSnapshot: { generation: 1, sessionId: 'admin-session-a' },
    permissionSession: { currentDeviceRole: 'admin', currentStaffUser: { permissions: {} } }
  };
  fixtures.store = {
    licenseDetails: {
      tenant_opaque_id: 'tenant-a',
      features: { support_center: true, support_tickets: true, support_channel: 'in_app' }
    },
    notificationsAccessDenied: false,
    createTicket: vi.fn().mockResolvedValue({ success: true, ticket: { id: TICKET_ID } }),
    openNotificationCenter: vi.fn()
  };
  fixtures.list.mockReset().mockResolvedValue([]);
  fixtures.summary.mockReset().mockResolvedValue({ requiringAttention: 0, pendingReceipt: 0, pendingProlonged: 0, conflict: 0, blocked: 0, projectionFailed: 0 });
  fixtures.getDiagnostic.mockReset().mockImplementation(async ({ intentId }) => diagnostic({ intentId, financialStatus: 'COMPLETED', projectionStatus: 'PENDING' }));
  fixtures.receipt.mockReset().mockResolvedValue({ outcome: 'receipt_completed' });
  fixtures.projection.mockReset().mockResolvedValue({ outcome: 'projection_applied' });
  fixtures.listTickets.mockReset().mockResolvedValue({ success: true, tickets: [] });
});

const diagnostic = (changes = {}) => ({
  intentId: CORRELATION_ID,
  operationLabel: 'Venta de cajero',
  operationType: 'sale.cashier',
  financialStatus: 'COMPLETED',
  projectionStatus: 'FAILED',
  healthStatus: 'PROJECTION_ATTENTION',
  originActorKey: 'admin:a',
  ageMs: 1000,
  dispatchAttemptCount: 1,
  recoveryAttemptCount: 0,
  createdAt: '2026-08-22T20:00:00.000Z',
  lastDispatchAt: null,
  lastRecoveryAt: null,
  lastProtocolCode: 'SAFE_CODE',
  lastRecoveryCode: null,
  recoveryLeaseState: 'NONE',
  recoveryLeaseUntil: null,
  idempotencyKeyFingerprint: 'fi…key',
  requestHashFingerprint: 'ha…hash',
  cashSessionId: null,
  cashStationId: null,
  allowedActions: { refreshReceipt: false, retryProjection: false, copyDiagnostic: true, requiresOriginActorLogin: false },
  ...changes
});

const pendingDiagnostic = (changes = {}) => diagnostic({
  financialStatus: 'PENDING_RECEIPT',
  projectionStatus: 'PENDING',
  healthStatus: 'RECEIPT_PENDING',
  allowedActions: { refreshReceipt: true, retryProjection: false, copyDiagnostic: true, requiresOriginActorLogin: false },
  ...changes
});

const attentionSummary = () => ({ requiringAttention: 1, pendingReceipt: 1, pendingProlonged: 0, conflict: 0, blocked: 0, projectionFailed: 0 });

const renderDiagnostic = async (row) => {
  fixtures.list.mockResolvedValue([row]);
  fixtures.summary.mockResolvedValue(attentionSummary());
  const view = render(<FinancialDiagnosticsPanel enabled />);
  fireEvent.click(await screen.findByRole('button', { name: 'Revisar detalles' }));
  await screen.findByText(row.operationLabel);
  return view;
};

describe('FinancialDiagnosticsPanel', () => {
  it('keeps the healthy staff surface compact while leaving details reachable', async () => {
    fixtures.mode = { ...fixtures.mode, actor: { actorKey: 'staff:b', isStaff: true } };
    fixtures.actorAccess = {
      ...fixtures.actorAccess,
      isAdmin: false,
      actorType: 'staff',
      actorId: 'staff-b',
      permissionSession: { currentDeviceRole: 'staff', currentStaffUser: { permissions: { support_center: true } } }
    };
    fixtures.list.mockResolvedValue([]);

    render(<FinancialDiagnosticsPanel enabled />);

    expect(await screen.findByText('Operaciones financieras al día')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Diagnóstico financiero' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver diagnóstico' }));
    expect(await screen.findByRole('heading', { name: 'Diagnóstico financiero' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Ocultar detalles' })).toBeVisible();
  });

  it('gives staff a simple attention message and reveals only intentional detail', async () => {
    fixtures.mode = { ...fixtures.mode, actor: { actorKey: 'staff:b', isStaff: true } };
    fixtures.list.mockResolvedValue([diagnostic({ originActorKey: 'staff:b' })]);
    fixtures.summary.mockResolvedValue(attentionSummary());

    render(<FinancialDiagnosticsPanel enabled />);

    expect(await screen.findByText('Hay una operación pendiente de verificar')).toBeVisible();
    expect(screen.queryByText('Venta de cajero')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Revisar detalles' }));
    expect(await screen.findByText('Venta de cajero')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Consultar recibo' })).toBeDisabled();
  });

  it('renders only the safe DTO and disables cross-actor admin actions', async () => {
    const row = pendingDiagnostic({
      originActorKey: 'staff:b',
      allowedActions: { refreshReceipt: false, retryProjection: false, copyDiagnostic: true, requiresOriginActorLogin: true }
    });
    fixtures.list.mockResolvedValue([row]);
    fixtures.summary.mockResolvedValue(attentionSummary());
    render(<FinancialDiagnosticsPanel enabled />);
    fireEvent.click(await screen.findByRole('button', { name: 'Revisar detalles' }));
    await screen.findByText('Venta de cajero');
    expect(screen.getByRole('button', { name: 'Consultar recibo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reintentar actualización local' })).toBeDisabled();
    expect(screen.getByText('Requiere iniciar sesión con el actor de origen.')).toBeTruthy();
    expect(document.body.textContent).not.toContain('transient-only');
    expect(document.body.textContent).not.toContain('requestPayload');
    fireEvent.click(await screen.findByRole('button', { name: 'Solicitar soporte' }));
    expect(await screen.findByText(`El servidor confirmó la recepción. Folio: ${TICKET_ID}.`)).toBeVisible();
    expect(fixtures.receipt).not.toHaveBeenCalled();
    expect(fixtures.projection).not.toHaveBeenCalled();
  });

  it('explains a confirmed receipt and verifies the local projection state', async () => {
    const row = pendingDiagnostic();
    fixtures.getDiagnostic.mockResolvedValue(diagnostic({ financialStatus: 'COMPLETED', projectionStatus: 'PENDING' }));
    await renderDiagnostic(row);
    fireEvent.click(screen.getByRole('button', { name: 'Consultar recibo' }));
    expect(await screen.findByText(/El recibo confirma la operación\. La proyección local sigue PENDING/)).toBeVisible();
    expect(fixtures.getDiagnostic).toHaveBeenCalledWith({ intentId: CORRELATION_ID });
  });

  it('explains a processing receipt without authorizing another financial send', async () => {
    fixtures.receipt.mockResolvedValue({ outcome: 'receipt_processing' });
    await renderDiagnostic(pendingDiagnostic());
    fireEvent.click(screen.getByRole('button', { name: 'Consultar recibo' }));
    expect(await screen.findByText(/continúa procesándose\. No la vuelvas a enviar/)).toBeVisible();
    expect(fixtures.receipt).toHaveBeenCalledTimes(1);
  });

  it('explains NOT_FOUND after an attempt and offers authorized support', async () => {
    fixtures.receipt.mockResolvedValue({ outcome: 'receipt_not_found_no_resend' });
    await renderDiagnostic(pendingDiagnostic());
    fireEvent.click(screen.getByRole('button', { name: 'Consultar recibo' }));
    expect(await screen.findByText(/resultado sigue sin determinarse\. No cobres nuevamente/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Solicitar soporte' })).toBeVisible();
  });

  it('offers support for an inconsistent PREPARED row that already has a dispatch attempt', async () => {
    await renderDiagnostic(pendingDiagnostic({
      financialStatus: 'PREPARED',
      dispatchAttemptCount: 1,
      allowedActions: { refreshReceipt: true, retryProjection: false, copyDiagnostic: true, requiresOriginActorLogin: false }
    }));

    expect(screen.getByRole('button', { name: 'Solicitar soporte' })).toBeVisible();
  });

  it('explains an unavailable receipt and keeps a safe query/support path', async () => {
    fixtures.receipt.mockResolvedValue({ outcome: 'receipt_unavailable' });
    await renderDiagnostic(pendingDiagnostic());
    fireEvent.click(screen.getByRole('button', { name: 'Consultar recibo' }));
    expect(await screen.findByText(/No se pudo consultar el recibo\. El resultado sigue pendiente/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Consultar recibo' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Solicitar soporte' })).toBeVisible();
  });

  it('explains a receipt conflict as requiring review', async () => {
    fixtures.receipt.mockResolvedValue({ outcome: 'receipt_conflict' });
    await renderDiagnostic(pendingDiagnostic({ financialStatus: 'CONFLICT', healthStatus: 'CONFLICT' }));
    fireEvent.click(screen.getByRole('button', { name: 'Consultar recibo' }));
    expect(await screen.findByText(/conflicto de idempotencia\. Mantén la operación bloqueada/)).toBeVisible();
  });

  it('confirms a created ticket only after a valid server folio and opens the existing support center', async () => {
    await renderDiagnostic(pendingDiagnostic());
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar soporte' }));
    expect(await screen.findByText(`El servidor confirmó la recepción. Folio: ${TICKET_ID}.`)).toBeVisible();
    await waitFor(() => expect(fixtures.store.createTicket).toHaveBeenCalledTimes(1));
    expect(fixtures.store.createTicket).toHaveBeenCalledWith(expect.objectContaining({
      subject: `Revisión financiera ${CORRELATION_ID}`,
      category: 'cash',
      priority: 'normal',
      metadata: { source: 'financial_diagnostics' },
      message: expect.stringContaining(`Identificador de correlación: ${CORRELATION_ID}`)
    }));
    expect(fixtures.store.openNotificationCenter).toHaveBeenCalledWith({ tab: 'support', ticketId: TICKET_ID });
    expect(fixtures.receipt).not.toHaveBeenCalled();
    expect(fixtures.store.createTicket.mock.calls[0][0].message).not.toContain('transient-only');
  });

  it('recovers a lost create response by finding the matching server ticket without creating another', async () => {
    fixtures.store.createTicket.mockResolvedValue({ success: false, message: 'network response lost' });
    fixtures.listTickets
      .mockResolvedValueOnce({ success: true, tickets: [] })
      .mockResolvedValueOnce({ success: true, tickets: [{ id: TICKET_ID, subject: `Revisión financiera ${CORRELATION_ID}` }] });
    await renderDiagnostic(pendingDiagnostic());
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar soporte' }));
    expect(await screen.findByText(`El servidor confirmó la recepción. Folio: ${TICKET_ID}.`)).toBeVisible();
    expect(fixtures.store.createTicket).toHaveBeenCalledTimes(1);
    expect(fixtures.store.openNotificationCenter).toHaveBeenCalledWith({ tab: 'support', ticketId: TICKET_ID });
  });

  it('keeps a lost ticket response uncertain when lookup finds no record and never resends automatically', async () => {
    fixtures.store.createTicket.mockResolvedValue({ success: false, message: 'network response lost' });
    await renderDiagnostic(pendingDiagnostic());
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar soporte' }));
    expect(await screen.findByText(/resultado sigue incierto; no se reenvió/)).toBeVisible();
    expect(screen.queryByText(/Folio:/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Consultar tickets' }));
    expect(await screen.findByText(/no se creó otro ticket automáticamente/)).toBeVisible();
    expect(fixtures.store.createTicket).toHaveBeenCalledTimes(1);
    expect(fixtures.receipt).not.toHaveBeenCalled();
  });

  it('directs staff without support_center permission to the administrator without calling ticket RPCs', async () => {
    fixtures.mode = { ...fixtures.mode, actor: { actorKey: 'staff:a', isStaff: true } };
    fixtures.actorAccess = {
      ...fixtures.actorAccess,
      isAdmin: false,
      actorType: 'staff',
      actorId: 'staff-a',
      permissionSession: { currentDeviceRole: 'staff', currentStaffUser: { permissions: { support_center: false } } }
    };
    await renderDiagnostic(pendingDiagnostic({ originActorKey: 'staff:a' }));
    expect(screen.getByText(/no tiene permiso para soporte interno\. Contacta al administrador/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Solicitar soporte' })).not.toBeInTheDocument();
    expect(fixtures.store.createTicket).not.toHaveBeenCalled();
    expect(fixtures.listTickets).not.toHaveBeenCalled();
  });

  it('provides the sanitized manual path when the license has no in-app support capability', async () => {
    fixtures.store.licenseDetails = {
      tenant_opaque_id: 'tenant-a',
      features: { support_center: false, support_tickets: false, support_channel: 'email' }
    };
    await renderDiagnostic(pendingDiagnostic());
    expect(screen.getByText(/Esta licencia no tiene tickets internos habilitados/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Copiar diagnóstico' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Solicitar soporte' })).not.toBeInTheDocument();
    expect(fixtures.store.createTicket).not.toHaveBeenCalled();
  });

  it.each(['actor', 'tenant'])('does not confirm or open a ticket when the %s changes during creation', async (changedContext) => {
    fixtures.store.createTicket.mockImplementation(async () => {
      fixtures[`${changedContext}Changed`] = true;
      return { success: true, ticket: { id: TICKET_ID } };
    });
    await renderDiagnostic(pendingDiagnostic());
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar soporte' }));
    await waitFor(() => expect(fixtures.store.createTicket).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Folio:/)).not.toBeInTheDocument();
    expect(fixtures.store.openNotificationCenter).not.toHaveBeenCalled();
  });

  it('serializes rapid double clicks so one conscious request can create at most one ticket in this view', async () => {
    fixtures.listTickets.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ success: true, tickets: [] }), 10)));
    await renderDiagnostic(pendingDiagnostic());
    const button = screen.getByRole('button', { name: 'Solicitar soporte' });
    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByText(`El servidor confirmó la recepción. Folio: ${TICKET_ID}.`);
    expect(fixtures.store.createTicket).toHaveBeenCalledTimes(1);
    expect(fixtures.listTickets).toHaveBeenCalledTimes(1);
  });
});
