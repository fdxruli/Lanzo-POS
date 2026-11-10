// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ permissions: {} }));
const hasPermission = (permission) => state.permissions[permission] === true;

vi.mock('../../../services/auth/useSettingsAccess', () => ({
  useSettingsAccess: () => ({
    canAccessSection: (section) => section === 'maintenance'
      && (hasPermission('settings_maintenance')
        || (!['settings_data', 'settings_controls', 'settings_maintenance', 'settings_backup']
          .some((permission) => Object.prototype.hasOwnProperty.call(state.permissions, permission))
          && (hasPermission('sync') || hasPermission('inventory'))))
  })
}));

vi.mock('../../common/UpdateControls', () => ({
  default: ({ showApply }) => (
    <div data-testid="maintenance-update-controls" data-show-apply={String(showApply)}>
      Buscar actualizaciones
    </div>
  )
}));

import MaintenanceSettings from '../MaintenanceSettings';

describe('MaintenanceSettings: solo actualizaciones', () => {
  afterEach(cleanup);

  beforeEach(() => {
    state.permissions = {};
  });

  it.each([
    ['permisos heredados de sincronización', { sync: true }],
    ['permisos heredados de inventario', { inventory: true }],
    ['permiso específico de la pestaña', { settings_maintenance: true, sync: false, inventory: false }]
  ])('muestra el control de actualizaciones con %s', (_, permissions) => {
    state.permissions = permissions;
    render(<MaintenanceSettings />);

    expect(screen.getByTestId('maintenance-update-controls')).toHaveAttribute('data-show-apply', 'true');
    for (const removed of [
      'Reconstruir desde historial', 'Sincronizar stock',
      'Archivar ventas antiguas', 'Gestionar datos', 'Salud operativa del sistema'
    ]) {
      expect(screen.queryByText(removed)).not.toBeInTheDocument();
    }
  });

  it('deniega acceso sin permiso para la sección', () => {
    state.permissions = { settings_maintenance: false, sync: true, inventory: true };
    render(<MaintenanceSettings />);

    expect(screen.getByRole('alert')).toHaveTextContent('No tienes acceso');
    expect(screen.queryByTestId('maintenance-update-controls')).not.toBeInTheDocument();
  });
});
