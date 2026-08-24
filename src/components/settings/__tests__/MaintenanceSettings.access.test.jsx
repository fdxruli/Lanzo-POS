// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  permissions: { sync: false, inventory: false, reports: false },
  stale: false,
  resolvePrompt: null,
  rebuildStats: vi.fn(),
  fixStock: vi.fn(),
  loadStats: vi.fn(),
  loadProducts: vi.fn()
}));

const hasPermission = (permission) => state.permissions[permission] === true;

vi.mock('../../../services/auth/useSettingsAccess', () => ({
  useSettingsAccess: () => ({
    canAccessPermission: hasPermission,
    canAccessSection: (section) => section === 'maintenance'
      && (hasPermission('sync') || hasPermission('inventory'))
  }),
  useSettingsActionGuard: () => (permission) => {
    if (!hasPermission(permission)) throw new Error('PERMISSION_DENIED');
    return {
      assertCurrent: () => {
        if (state.stale) throw new Error('ACTOR_CONTEXT_STALE');
      }
    };
  }
}));

vi.mock('../../../store/useStatsStore', () => ({
  useStatsStore: vi.fn((selector) => selector({ loadStats: state.loadStats }))
}));

vi.mock('../../../store/useInventoryCatalogStore', () => ({
  useInventoryCatalogStore: vi.fn((selector) => selector({
    loadInitialProducts: state.loadProducts
  }))
}));

vi.mock('../../../services/db', () => ({
  maintenanceTools: {
    rebuildStats: state.rebuildStats,
    fixStock: state.fixStock
  }
}));

vi.mock('../../../services/database', () => ({ archiveOldData: vi.fn() }));

vi.mock('../../../services/BackupRiskEvaluator', () => ({
  evaluator: { ping: vi.fn() }
}));

vi.mock('../../../services/utils', () => ({
  showConfirmModal: vi.fn(async () => true),
  showMessageModal: vi.fn()
}));

vi.mock('../../common/InputPromptModal', () => ({
  showInputPromptModal: vi.fn(() => new Promise((resolve) => {
    state.resolvePrompt = resolve;
  }))
}));

vi.mock('../../products/DataTransferModal', () => ({
  default: ({ show, allowInventory, allowSalesExport }) => show
    ? <div data-testid="data-transfer">inventory:{String(allowInventory)} sync:{String(allowSalesExport)}</div>
    : null
}));

import MaintenanceSettings from '../MaintenanceSettings';

const renderSettings = () => render(
  <MemoryRouter>
    <MaintenanceSettings />
  </MemoryRouter>
);

describe('MaintenanceSettings action isolation', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    state.permissions = { sync: false, inventory: false, reports: false };
    state.stale = false;
    state.resolvePrompt = null;
    state.rebuildStats.mockResolvedValue({ success: true, message: 'ok' });
    state.fixStock.mockResolvedValue({ success: true, message: 'ok', details: [] });
  });

  it('shows only sync-authorized routines to sync-only Staff', () => {
    state.permissions.sync = true;
    renderSettings();

    expect(screen.getByText('Reconstruir desde historial')).toBeInTheDocument();
    expect(screen.getByText('Archivar ventas antiguas')).toBeInTheDocument();
    expect(screen.queryByText('Sincronizar stock')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Gestionar datos/i })).not.toBeInTheDocument();
  });

  it('shows only inventory-authorized routines to inventory-only Staff', () => {
    state.permissions.inventory = true;
    renderSettings();

    expect(screen.getByText('Sincronizar stock')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Gestionar datos/i })).toBeInTheDocument();
    expect(screen.queryByText('Reconstruir desde historial')).not.toBeInTheDocument();
    expect(screen.queryByText('Archivar ventas antiguas')).not.toBeInTheDocument();
  });

  it('fails closed when neither maintenance permission is present', () => {
    renderSettings();
    expect(screen.getByRole('alert')).toHaveTextContent('No tienes permiso');
  });

  it('does not execute a sync action after its actor handle becomes stale', async () => {
    state.permissions.sync = true;
    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Reconstruir' }));
    await waitFor(() => expect(state.resolvePrompt).toBeTypeOf('function'));
    state.stale = true;
    await act(async () => {
      state.resolvePrompt('CONFIRMAR');
      await Promise.resolve();
    });

    expect(state.rebuildStats).not.toHaveBeenCalled();
  });

  it('does not pass sales-export authority without reports permission', () => {
    state.permissions = { sync: true, inventory: true, reports: false };
    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: /Gestionar datos/i }));
    expect(screen.getByTestId('data-transfer')).toHaveTextContent('inventory:true sync:false');
  });

  it('passes sales-export authority only when sync and reports are both current', () => {
    state.permissions = { sync: true, inventory: false, reports: true };
    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: /Gestionar datos/i }));
    expect(screen.getByTestId('data-transfer')).toHaveTextContent('inventory:false sync:true');
  });
});
