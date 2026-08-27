// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fixtures = vi.hoisted(() => ({
  list: vi.fn(), summary: vi.fn(), receipt: vi.fn(), projection: vi.fn(),
  mode: {
    cloudEnabled: true,
    licenseKey: 'transient-only',
    licenseDetails: { tenant_opaque_id: 'tenant-a' },
    actor: { actorKey: 'admin:a', isStaff: false }
  }
}));

vi.mock('../../../../services/cash/cashActor', () => ({
  getCashMode: () => fixtures.mode
}));
vi.mock('../../../../services/financial/financialIntentObservability', () => ({
  listFinancialIntentDiagnostics: (...args) => fixtures.list(...args),
  getFinancialDiagnosticSummary: (...args) => fixtures.summary(...args)
}));
vi.mock('../../../../services/financial/financialReceiptReconciliation', () => ({ refreshFinancialIntentReceipt: (...args) => fixtures.receipt(...args) }));
vi.mock('../../../../services/financial/financialProjectionRepair', () => ({ retryFinancialIntentProjection: (...args) => fixtures.projection(...args) }));
vi.mock('../../../../services/financial/financialIntentDiagnostics', () => ({
  buildFinancialDiagnosticText: (diagnostic) => `Intent: ${diagnostic.intentId}\nEstado: ${diagnostic.financialStatus}`
}));

import FinancialDiagnosticsPanel from '../FinancialDiagnosticsPanel';

afterEach(() => cleanup());
beforeEach(() => {
  vi.clearAllMocks();
  fixtures.mode = {
    cloudEnabled: true,
    licenseKey: 'transient-only',
    licenseDetails: { tenant_opaque_id: 'tenant-a' },
    actor: { actorKey: 'admin:a', isStaff: false }
  };
});

const diagnostic = (changes = {}) => ({
  intentId: 'intent-safe', operationLabel: 'Venta de cajero', operationType: 'sale.cashier',
  financialStatus: 'COMPLETED', projectionStatus: 'FAILED', healthStatus: 'PROJECTION_ATTENTION',
  originActorKey: 'staff:b', ageMs: 1000, dispatchAttemptCount: 1, recoveryAttemptCount: 0,
  createdAt: '2026-08-22T20:00:00.000Z', lastDispatchAt: null, lastRecoveryAt: null,
  lastProtocolCode: 'SAFE_CODE', lastRecoveryCode: null, recoveryLeaseState: 'NONE', recoveryLeaseUntil: null,
  idempotencyKeyFingerprint: 'fi…key', requestHashFingerprint: 'ha…hash', cashSessionId: null, cashStationId: null,
  allowedActions: { refreshReceipt: false, retryProjection: false, copyDiagnostic: true, requiresOriginActorLogin: true },
  requestPayload: undefined, responsePayload: undefined, canonicalRequest: undefined,
  ...changes
});

describe('FinancialDiagnosticsPanel', () => {
  it('keeps the healthy staff surface compact while leaving details reachable', async () => {
    fixtures.mode = {
      ...fixtures.mode,
      actor: { actorKey: 'staff:b', isStaff: true }
    };
    fixtures.list.mockResolvedValue([]);
    fixtures.summary.mockResolvedValue({ requiringAttention: 0, pendingReceipt: 0, pendingProlonged: 0, conflict: 0, blocked: 0, projectionFailed: 0 });

    render(<FinancialDiagnosticsPanel enabled />);

    expect(await screen.findByText('Operaciones financieras al día')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Diagnóstico financiero' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver diagnóstico' }));
    expect(await screen.findByRole('heading', { name: 'Diagnóstico financiero' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Ocultar detalles' })).toBeVisible();
  });

  it('gives staff a simple attention message and reveals only intentional detail', async () => {
    fixtures.mode = {
      ...fixtures.mode,
      actor: { actorKey: 'staff:b', isStaff: true }
    };
    fixtures.list.mockResolvedValue([diagnostic({ originActorKey: 'staff:b' })]);
    fixtures.summary.mockResolvedValue({ requiringAttention: 1, pendingReceipt: 0, pendingProlonged: 0, conflict: 0, blocked: 0, projectionFailed: 1 });

    render(<FinancialDiagnosticsPanel enabled />);

    expect(await screen.findByText('Hay una operación pendiente de verificar')).toBeVisible();
    expect(screen.queryByText('Venta de cajero')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Revisar detalles' }));
    expect(await screen.findByText('Venta de cajero')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Consultar recibo' })).toBeDisabled();
  });

  it('renders only the safe DTO and disables cross-actor admin actions', async () => {
    fixtures.list.mockResolvedValue([diagnostic()]);
    fixtures.summary.mockResolvedValue({ requiringAttention: 1, pendingReceipt: 0, pendingProlonged: 0, conflict: 0, blocked: 0, projectionFailed: 1 });
    render(<FinancialDiagnosticsPanel enabled />);
    fireEvent.click(await screen.findByRole('button', { name: 'Revisar detalles' }));
    await waitFor(() => expect(screen.getByText('Venta de cajero')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Consultar recibo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reintentar actualización local' })).toBeDisabled();
    expect(screen.getByText('Requiere iniciar sesión con el actor de origen.')).toBeTruthy();
    expect(document.body.textContent).not.toContain('transient-only');
    expect(document.body.textContent).not.toContain('requestPayload');
  });

  it('uses only the explicit safe receipt and projection actions for its own actor', async () => {
    fixtures.list.mockResolvedValue([diagnostic({
      intentId: 'intent-own', originActorKey: 'admin:a',
      allowedActions: { refreshReceipt: true, retryProjection: true, copyDiagnostic: true, requiresOriginActorLogin: false }
    })]);
    fixtures.summary.mockResolvedValue({ requiringAttention: 1, pendingReceipt: 0, pendingProlonged: 0, conflict: 0, blocked: 0, projectionFailed: 1 });
    fixtures.receipt.mockResolvedValue({ outcome: 'receipt_completed' });
    fixtures.projection.mockResolvedValue({ outcome: 'projection_applied' });
    render(<FinancialDiagnosticsPanel enabled />);
    fireEvent.click(await screen.findByRole('button', { name: 'Revisar detalles' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Consultar recibo' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Consultar recibo' }));
    await waitFor(() => expect(fixtures.receipt).toHaveBeenCalledWith({ intentId: 'intent-own', licenseKey: 'transient-only' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar actualización local' }));
    await waitFor(() => expect(fixtures.projection).toHaveBeenCalledWith({ intentId: 'intent-own' }));
  });
});
