// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({
  hook: null, business: false, audit: vi.fn(), modals: [], message: vi.fn()
}));

vi.mock('../../hooks/useCaja', () => ({ useCaja: () => fx.hook }));
vi.mock('../../hooks/useModal', () => ({
  useModal: () => {
    const modalRef = React.useRef(null);
    if (!modalRef.current) {
      modalRef.current = { isOpen: false, open: vi.fn(), close: vi.fn() };
      fx.modals.push(modalRef.current);
    }
    return modalRef.current;
  }
}));
vi.mock('../../hooks/useRecentActivity', () => ({ useRecentActivity: () => ({ lastActivity: null, isActive: true }) }));
vi.mock('../../store/useAppStore', () => ({
  useAppStore: (selector) => selector({
    isBackupLoading: false, setBackupLoading: vi.fn(), isDriveConnected: false,
    needsDriveReauth: false, markDriveNeedsReauth: vi.fn()
  })
}));
vi.mock('../../services/utils', () => ({ showConfirmModal: vi.fn(), showMessageModal: (...args) => fx.message(...args) }));
vi.mock('../../services/dataTransfer', () => ({
  downloadBackupSmart: vi.fn(), BACKUP_ABORT_REASON: 'aborted', BACKUP_WARNING_BLOB_PERF: 'blob'
}));
vi.mock('../../services/backup/backupManager', () => ({ backupManager: { backup: vi.fn() } }));
vi.mock('../../services/googleDriveService', () => ({ uploadBackup: vi.fn() }));
vi.mock('../../services/Logger', () => ({ default: { error: vi.fn(), warn: vi.fn() } }));
vi.mock('../../services/cash/businessCashSummary', () => ({
  canShowBusinessCashSummary: ({ isCloudCash, isReadOnly }) => Boolean(fx.business && isCloudCash && !isReadOnly)
}));
vi.mock('../../services/cash/cashDeviceLabel', () => ({ buildLegacyCashAdoptionConfirmation: () => '' }));
vi.mock('../../components/common/AuditModal', () => ({
  default: ({ show }) => show ? <div role="dialog" aria-label="Corte de caja del propietario">Corte</div> : null
}));
vi.mock('../../components/caja/modals', () => ({
  EditInitialModal: () => null, CashAdjustmentModal: () => null,
  CashEntryModal: () => null, CashExitModal: () => null, ResumenEstadisticoModal: () => null
}));
vi.mock('../../components/caja/sections', () => ({
  CajaSectionTabs: ({ sections, activeSection, onChange }) => (
    <div role="tablist">{sections.map((section) => (
      <button key={section.id} type="button" role="tab" aria-selected={activeSection === section.id} onClick={() => onChange(section.id)}>
        {section.label}
      </button>
    ))}</div>
  ),
  CajaStatusCard: () => <div data-testid="turno-status">Efectivo teorico de mi caja</div>,
  CajaActionsCard: ({ onCorte, onEntrada, onSalida, onAjuste, isReadOnly, readOnlyMessage }) => (
    <div data-testid="turno-actions">
      {isReadOnly && <div role="alert">{readOnlyMessage}</div>}
      <button type="button" onClick={onCorte} disabled={isReadOnly}>Corte de caja</button>
      <button type="button" onClick={onEntrada} disabled={isReadOnly}>Entrada</button>
      <button type="button" onClick={onSalida} disabled={isReadOnly}>Salida</button>
      <button type="button" onClick={onAjuste} disabled={isReadOnly}>Ajuste de caja</button>
    </div>
  ),
  CajaMovementsList: () => {
    const [value, setValue] = React.useState('');
    return <div data-testid="movements-list"><input aria-label="Buscar movimientos" value={value} onChange={(e) => setValue(e.target.value)} /></div>;
  },
  CajaHistoryList: () => {
    const [page, setPage] = React.useState(1);
    return <div data-testid="history-list"><span>Historial pagina {page}</span><button type="button" onClick={() => setPage(2)} disabled={page === 2}>Siguiente</button></div>;
  },
  CajaBusinessCashSummary: () => <div data-testid="business-summary">Efectivo del negocio</div>,
  CajaStaffAuditPanel: ({ listCashSessionsForAudit }) => {
    React.useEffect(() => { listCashSessionsForAudit(); }, [listCashSessionsForAudit]);
    return <div data-testid="staff-audit"><button type="button" onClick={listCashSessionsForAudit}>Actualizar</button></div>;
  },
  CajaAdminCashAuditModal: () => null, CajaOpeningPanel: () => null,
  CajaLegacyCashTransition: () => null, FinancialDiagnosticsPanel: () => null
}));

import React from 'react';
import CajaPage from '../CajaPage';

const makeState = ({
  actorKey = 'local:default', isStaff = false, isCloudCash = false, isCloudCashReadOnly = false
} = {}) => ({
  cajaActual: { id: 'cash-own', actor_key: actorKey, estado: 'abierta', monto_inicial: '100' },
  historialCajas: [], movimientosCaja: [], isLoading: false, estadoCaja: 'open',
  aperturaPendiente: null, error: null, totalesTurno: { ventasContado: '0', abonosFiado: '0' },
  isCloudCash, isCloudCashReadOnly, cashActor: { actorKey, isStaff, responsibleName: 'Responsable A' },
  adminCashSessions: [], legacyAdminCashSessions: [], listCashSessionsForAudit: fx.audit,
  getCashSessionDetailForAudit: vi.fn(), cerrarCajaAdministrativamente: vi.fn(),
  adoptarCajaLegacy: vi.fn(), abrirCaja: vi.fn(), ajustarMontoInicial: vi.fn(),
  realizarAuditoriaYCerrar: vi.fn(), registrarMovimiento: vi.fn(),
  calcularTotalTeorico: vi.fn().mockResolvedValue('100'), registrarAjusteCaja: vi.fn(),
  sincronizarEstadoCaja: vi.fn(), obtenerResumenEstadistico: vi.fn(), descargarReporteCaja: vi.fn(),
  verificarExcesoLiquidez: vi.fn().mockResolvedValue(false), CAJA_CONFIG: { MAX_CASH_THRESHOLD: 50000 }
});

const clickTab = (name) => fireEvent.click(screen.getByRole('tab', { name }));
const tabLabels = () => screen.getAllByRole('tab').map((tab) => tab.textContent);

beforeEach(() => {
  cleanup(); fx.business = false; fx.audit = vi.fn(); fx.modals = []; fx.message.mockClear();
  fx.hook = makeState();
});
afterEach(cleanup);

describe('CajaPage progressive disclosure', () => {
  it.each([
    ['local', { isCloudCash: false }],
    ['cloud staff', { isCloudCash: true, isStaff: true, actorKey: 'staff:one' }]
  ])('shows %s tabs without Negocio', async (_name, state) => {
    fx.hook = makeState(state); render(<CajaPage />);
    await waitFor(() => expect(tabLabels()).toEqual(['Turno', 'Movimientos', 'Historial']));
    expect(screen.getByRole('tab', { name: 'Turno' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tab', { name: 'Negocio' })).not.toBeInTheDocument();
  });

  it('shows Negocio for a cloud Admin with business visibility and lazy-mounts content', () => {
    fx.business = true; fx.hook = makeState({ isCloudCash: true, actorKey: 'admin:one' });
    render(<CajaPage />);
    expect(tabLabels()).toEqual(['Turno', 'Movimientos', 'Historial', 'Negocio']);
    expect(screen.queryByTestId('business-summary')).not.toBeInTheDocument();
    clickTab('Negocio');
    expect(screen.getByTestId('business-summary')).toBeVisible();
    expect(screen.queryByTestId('staff-audit')).not.toBeInTheDocument();
    expect(fx.audit).not.toHaveBeenCalled();
  });

  it('keeps movement filters and history page alive between section changes', () => {
    render(<CajaPage />);
    expect(screen.queryByTestId('movements-list')).not.toBeInTheDocument();
    expect(screen.queryByTestId('history-list')).not.toBeInTheDocument();
    clickTab('Movimientos');
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar movimientos' }), { target: { value: 'EC-1' } });
    clickTab('Turno'); clickTab('Movimientos');
    expect(screen.getByRole('textbox', { name: 'Buscar movimientos' })).toHaveValue('EC-1');
    clickTab('Historial');
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByText('Historial pagina 2')).toBeVisible();
    clickTab('Turno'); clickTab('Historial');
    expect(screen.getByText('Historial pagina 2')).toBeVisible();
  });

  it('loads Staff audit only after explicit opening and never on tab churn', async () => {
    fx.business = true; fx.hook = makeState({ isCloudCash: true, actorKey: 'admin:one' });
    render(<CajaPage />); clickTab('Negocio');
    const summary = screen.getByText(/Auditor/);
    expect(fx.audit).not.toHaveBeenCalled();
    fireEvent.click(summary);
    await waitFor(() => expect(screen.getByTestId('staff-audit')).toBeInTheDocument());
    expect(fx.audit).toHaveBeenCalledTimes(1);
    fireEvent.click(summary); fireEvent.click(summary);
    clickTab('Turno'); clickTab('Negocio');
    expect(fx.audit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(fx.audit).toHaveBeenCalledTimes(2);
  });

  it('falls back to Turno and unmounts business content on authority loss', async () => {
    fx.business = true; fx.hook = makeState({ isCloudCash: true, actorKey: 'admin:one' });
    const view = render(<CajaPage />); clickTab('Negocio');
    expect(screen.getByTestId('business-summary')).toBeVisible();
    fx.business = false; fx.hook = makeState({ isCloudCash: true, isStaff: true, actorKey: 'staff:two' });
    view.rerender(<CajaPage />);
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'Negocio' })).not.toBeInTheDocument());
    expect(screen.getByRole('tab', { name: 'Turno' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('business-summary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('staff-audit')).not.toBeInTheDocument();
  });

  it('preserves primary action callbacks and read-only disablement', () => {
    render(<CajaPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Corte de caja' }));
    fireEvent.click(screen.getByRole('button', { name: 'Entrada' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salida' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ajuste de caja' }));
    expect(screen.getByRole('dialog', { name: 'Corte de caja del propietario' })).toBeVisible();
    expect(fx.modals[1].open).toHaveBeenCalledTimes(1);
    expect(fx.modals[2].open).toHaveBeenCalledTimes(1);
    expect(fx.modals[3].open).toHaveBeenCalledTimes(1);
    cleanup(); fx.hook = makeState({ isCloudCash: true, isCloudCashReadOnly: true, actorKey: 'admin:ro' });
    render(<CajaPage />);
    expect(screen.getByRole('alert')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Entrada' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Salida' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ajuste de caja' })).toBeDisabled();
  });
});
