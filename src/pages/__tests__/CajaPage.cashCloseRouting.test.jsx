// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  hookState: null,
  showMessage: vi.fn(),
  closeAdmin: vi.fn(),
  ownerClose: vi.fn(),
  setBackupLoading: vi.fn()
}));

vi.mock('../../hooks/useCaja', () => ({ useCaja: () => fixtures.hookState }));
vi.mock('../../hooks/useModal', () => ({
  useModal: () => ({ isOpen: false, open: vi.fn(), close: vi.fn() })
}));
vi.mock('../../hooks/useRecentActivity', () => ({
  useRecentActivity: () => ({ lastActivity: null, isActive: true })
}));
vi.mock('../../store/useAppStore', () => ({
  useAppStore: (selector) => selector({
    isBackupLoading: false,
    setBackupLoading: fixtures.setBackupLoading,
    isDriveConnected: false,
    needsDriveReauth: false,
    markDriveNeedsReauth: vi.fn()
  })
}));
vi.mock('../../services/utils', () => ({
  showConfirmModal: vi.fn(),
  showMessageModal: (...args) => fixtures.showMessage(...args)
}));
vi.mock('../../services/dataTransfer', () => ({
  downloadBackupSmart: vi.fn(),
  BACKUP_ABORT_REASON: 'aborted',
  BACKUP_WARNING_BLOB_PERF: 'blob-performance'
}));
vi.mock('../../services/backup/backupManager', () => ({ backupManager: { backup: vi.fn() } }));
vi.mock('../../services/googleDriveService', () => ({ uploadBackup: vi.fn() }));
vi.mock('../../services/Logger', () => ({ default: { error: vi.fn(), warn: vi.fn() } }));
vi.mock('../../services/cash/businessCashSummary', () => ({ canShowBusinessCashSummary: () => false }));
vi.mock('../../services/cash/cashDeviceLabel', () => ({ buildLegacyCashAdoptionConfirmation: () => '' }));

vi.mock('../../components/common/AuditModal', () => ({
  default: ({ show }) => show ? <div role="dialog" aria-label="Corte de caja del propietario">Corte de caja</div> : null
}));

vi.mock('../../components/caja/modals', () => ({
  EditInitialModal: () => null,
  CashAdjustmentModal: () => null,
  CashEntryModal: () => null,
  CashExitModal: () => null,
  ResumenEstadisticoModal: () => null
}));

vi.mock('../../components/caja/sections', () => ({
  CajaStatusCard: () => null,
  CajaActionsCard: ({ onCorte }) => <button type="button" onClick={onCorte}>Corte de caja</button>,
  CajaMovementsList: () => null,
  CajaHistoryList: () => null,
  CajaStaffAuditPanel: ({ onReviewSession }) => (
    <button type="button" onClick={() => onReviewSession({ id: 'cash-foreign-staff' })}>Revisar caja ajena</button>
  ),
  CajaBusinessCashSummary: () => null,
  CajaAdminCashAuditModal: ({ cashSessionId, onClose, cerrarCajaAdministrativamente }) => cashSessionId ? (
    <div role="dialog" aria-label="Auditoría administrativa">
      <span>Auditoría administrativa</span>
      <button
        type="button"
        onClick={async () => {
          const result = await cerrarCajaAdministrativamente({ cashSessionId });
          if (result?.success) onClose({ closed: true, cashSessionId });
        }}
      >
        Confirmar cierre administrativo
      </button>
    </div>
  ) : null,
  CajaOpeningPanel: () => null,
  CajaLegacyCashTransition: () => null,
  FinancialDiagnosticsPanel: () => null,
  CajaSectionTabs: () => null
}));

import CajaPage, { isCashSessionOwnedByActor } from '../CajaPage';

const makeHookState = ({
  actorKey = 'admin:stable-admin',
  isStaff = false,
  cajaActual = { id: 'cash-own', actor_key: actorKey, estado: 'abierta', monto_inicial: '100', entradas_efectivo: '0', salidas_efectivo: '0' },
  estadoCaja = 'open',
  aperturaPendiente = null
} = {}) => ({
  cajaActual,
  historialCajas: [],
  movimientosCaja: [],
  isLoading: false,
  estadoCaja,
  aperturaPendiente,
  error: null,
  totalesTurno: { ventasContado: '0', abonosFiado: '0' },
  isCloudCash: true,
  isCloudCashReadOnly: false,
  cashActor: { actorKey, isStaff, responsibleName: isStaff ? 'Personal B' : 'Administradora A' },
  adminCashSessions: [],
  legacyAdminCashSessions: [],
  listCashSessionsForAudit: vi.fn(),
  getCashSessionDetailForAudit: vi.fn(),
  cerrarCajaAdministrativamente: fixtures.closeAdmin,
  adoptarCajaLegacy: vi.fn(),
  abrirCaja: vi.fn(),
  ajustarMontoInicial: vi.fn(),
  realizarAuditoriaYCerrar: fixtures.ownerClose,
  registrarMovimiento: vi.fn(),
  calcularTotalTeorico: vi.fn().mockResolvedValue('100'),
  registrarAjusteCaja: vi.fn(),
  sincronizarEstadoCaja: vi.fn(),
  obtenerResumenEstadistico: vi.fn(),
  descargarReporteCaja: vi.fn(),
  verificarExcesoLiquidez: vi.fn().mockResolvedValue(false),
  CAJA_CONFIG: { MAX_CASH_THRESHOLD: 50000 }
});

beforeEach(() => {
  vi.clearAllMocks();
  fixtures.closeAdmin.mockResolvedValue({ success: true });
  fixtures.ownerClose.mockResolvedValue({ success: true, diferencia: '0' });
  fixtures.hookState = makeHookState();
});

afterEach(cleanup);

describe('CajaPage cash close routing', () => {
  it('compares the stable actor key across both cash session field aliases', () => {
    expect(isCashSessionOwnedByActor({ actor_key: 'admin:a' }, { actorKey: 'admin:a' })).toBe(true);
    expect(isCashSessionOwnedByActor({ actorKey: 'staff:b' }, { actorKey: 'staff:b' })).toBe(true);
    expect(isCashSessionOwnedByActor({ actor_key: 'admin:a' }, { actorKey: 'admin:b' })).toBe(false);
    expect(isCashSessionOwnedByActor({ responsible_name: 'Administradora A' }, { actorKey: 'admin:a' })).toBe(false);
  });

  it('routes a cloud Admin closing their own stable session to the normal owner Corte', () => {
    fixtures.hookState = makeHookState({
      actorKey: 'admin:stable-admin',
      cajaActual: { id: 'cash-admin-own', actor_key: 'admin:stable-admin', estado: 'abierta', monto_inicial: '100' }
    });

    render(<CajaPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Corte de caja' }));

    expect(screen.getByRole('dialog', { name: 'Corte de caja del propietario' })).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'Auditoría administrativa' })).not.toBeInTheDocument();
    expect(fixtures.closeAdmin).not.toHaveBeenCalled();
  });

  it('routes Staff closing their own stable session to the normal owner Corte', () => {
    fixtures.hookState = makeHookState({
      actorKey: 'staff:stable-staff',
      isStaff: true,
      cajaActual: { id: 'cash-staff-own', actorKey: 'staff:stable-staff', estado: 'abierta', monto_inicial: '100' }
    });

    render(<CajaPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Corte de caja' }));

    expect(screen.getByRole('dialog', { name: 'Corte de caja del propietario' })).toBeVisible();
    expect(fixtures.closeAdmin).not.toHaveBeenCalled();
  });

  it('keeps foreign Admin closure on the explicit administrative review surface', async () => {
    fixtures.hookState = makeHookState({
      actorKey: 'admin:stable-admin',
      cajaActual: null,
      estadoCaja: 'financial_handoff_required',
      aperturaPendiente: {
        stationOpenCashSession: {
          id: 'cash-foreign-staff',
          actor_key: 'staff:stable-staff',
          responsible_name: 'Personal B'
        }
      }
    });

    render(<CajaPage />);
    expect(screen.queryByRole('button', { name: 'Corte de caja' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revisar caja ajena' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cierre administrativo' }));

    await waitFor(() => expect(fixtures.closeAdmin).toHaveBeenCalledWith({ cashSessionId: 'cash-foreign-staff' }));
    expect(fixtures.showMessage).toHaveBeenCalledWith('Cierre administrativo completado.', null, { type: 'success' });
  });

  it('keeps Staff foreign handoff blocking and de-emphasizes technical identifiers', () => {
    const fullSessionId = 'cash_1234567890abcdefghijklmnopqrstuvwxyz';
    const fullOwnerKey = 'admin:1234567890abcdefghijklmnopqrstuvwxyz';
    fixtures.hookState = makeHookState({
      actorKey: 'staff:stable-staff',
      isStaff: true,
      cajaActual: null,
      estadoCaja: 'financial_handoff_required',
      aperturaPendiente: {
        stationOpenCashSession: {
          id: fullSessionId,
          actor_key: fullOwnerKey,
          responsible_name: 'Administradora Ana'
        }
      }
    });

    render(<CajaPage />);

    expect(screen.getByText('Caja protegida por cambio de usuario')).toBeVisible();
    expect(screen.getByText('Administradora Ana')).toBeVisible();
    expect(screen.getByText('Pendiente de cierre y conteo')).toBeVisible();
    expect(screen.getByText(/debe completar el cierre antes/i)).toBeVisible();
    expect(screen.getByText('Ver detalles técnicos')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Corte de caja' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revisar caja ajena' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(fullSessionId);
    expect(document.body.textContent).not.toContain(fullOwnerKey);
    expect(document.body.textContent).not.toContain('Propietario histórico');
    expect(fixtures.closeAdmin).not.toHaveBeenCalled();
  });
});
