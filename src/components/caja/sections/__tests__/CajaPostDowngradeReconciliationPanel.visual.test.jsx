import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CajaPostDowngradeReconciliationPanel from '../CajaPostDowngradeReconciliationPanel';

const state = vi.hoisted(() => ({ online: true }));
const sessions = [
  { id: 'cash-1', responsible_name: 'Ana', opening_device_name: 'Android', expected_cash_total: 600, original_device_active: false },
  { id: 'cash-2', responsible_name: 'Luis', opening_device_name: 'Windows', expected_cash_total: 100 },
  { id: 'cash-3', responsible_name: 'Rosa', opening_device_name: 'Android', expected_cash_total: 300 },
  { id: 'cash-4', responsible_name: 'Tania', opening_device_name: 'Windows', expected_cash_total: 800 }
];

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector({ licenseDetails: {} })
}));
vi.mock('../../../services/sync/syncConstants', () => ({
  getLicenseKeyFromDetails: () => 'TEST'
}));
vi.mock('../../../services/cash/postDowngradeCashReconciliation', () => ({
  postDowngradeCashReconciliation: { detail: vi.fn(), close: vi.fn() }
}));
vi.mock('../../../hooks/usePostDowngradeCashPending', () => ({
  default: () => ({
    eligible: true,
    online: state.online,
    status: 'success',
    pendingCount: 4,
    cashSessions: sessions,
    isPostDowngrade: true,
    error: null,
    refresh: vi.fn()
  })
}));
vi.mock('../CajaAdminCashAuditModal', () => ({
  default: ({ cashSessionId }) => cashSessionId
    ? <div data-testid="selected-cash-session">{cashSessionId}</div>
    : null
}));

afterEach(() => {
  cleanup();
  state.online = true;
});

describe('Caja del plan anterior: navegación visual sin modificar cierre', () => {
  it('muestra tres cajas inicialmente y permite ver todas y revisar una sesión', () => {
    render(<CajaPostDowngradeReconciliationPanel />);
    expect(screen.getByText('4 pendientes')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('Dispositivo inactivo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver todas las cajas (4)' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Revisar y conciliar caja de Tania' }));
    expect(screen.getByTestId('selected-cash-session')).toHaveTextContent('cash-4');
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar menos' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('deshabilita revisión sin conexión y conserva el aviso', () => {
    state.online = false;
    render(<CajaPostDowngradeReconciliationPanel />);
    expect(screen.getAllByRole('button', { name: /Revisar y conciliar caja de/ })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: /Revisar y conciliar caja de/ })
      .every((button) => button.disabled)).toBe(true);
    expect(screen.getByText(/Conéctate a internet para revisar y cerrar/)).toBeInTheDocument();
  });
});
