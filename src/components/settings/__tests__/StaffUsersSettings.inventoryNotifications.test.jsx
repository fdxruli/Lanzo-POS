// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listStaffUsersService: vi.fn(),
  createStaffUserService: vi.fn(),
  updateStaffUserService: vi.fn(),
  showMessageModal: vi.fn()
}));

vi.mock('../../../services/licenseService', () => ({
  createStaffUserService: mocks.createStaffUserService,
  listStaffUsersService: mocks.listStaffUsersService,
  updateStaffUserService: mocks.updateStaffUserService
}));

vi.mock('../../../services/utils', () => ({
  showMessageModal: mocks.showMessageModal
}));

vi.mock('../../../hooks/useDismissibleHistoryLayer', () => ({
  useDismissibleHistoryLayer: ({ onDismiss }) => onDismiss
}));

import StaffUsersSettings from '../StaffUsersSettings';

const makeUser = (permissions) => ({
  id: 'staff-inventory',
  username: 'legacy',
  display_name: 'Legacy Staff',
  role_name: 'custom',
  is_active: true,
  last_login_at: null,
  permissions
});

const openInventoryPermission = async (permissions) => {
  mocks.listStaffUsersService.mockResolvedValue({
    success: true,
    data: [makeUser(permissions)]
  });

  render(<StaffUsersSettings licenseKey="LIC-PHASE5" />);
  await waitFor(() => expect(screen.getByText('Legacy Staff')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Editar' }));

  const cloudGroupLabel = screen.getByText('Lanzo Nube', { selector: 'strong' });
  const cloudDetails = cloudGroupLabel.closest('details');
  if (!cloudDetails?.open) {
    fireEvent.click(cloudGroupLabel);
  }

  return screen.getByRole('checkbox', { name: /Alertas de inventario/ });
};

describe('StaffUsersSettings inventory notification permission', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createStaffUserService.mockResolvedValue({ success: true });
    mocks.updateStaffUserService.mockResolvedValue({ success: true });
  });

  it('inherits explicit legacy Operations=true when Inventory is absent', async () => {
    const inventory = await openInventoryPermission({
      notifications: true,
      notifications_operations: true
    });
    expect(inventory).toBeChecked();
    expect(inventory).not.toBeDisabled();
  });

  it('inherits explicit legacy Operations=false when Inventory is absent', async () => {
    const inventory = await openInventoryPermission({
      notifications: true,
      notifications_operations: false
    });
    expect(inventory).not.toBeChecked();
    expect(inventory).not.toBeDisabled();
  });

  it('preserves very old notifications=true access when both granular keys are absent', async () => {
    const inventory = await openInventoryPermission({ notifications: true });
    expect(inventory).toBeChecked();
  });

  it('lets explicit Inventory override legacy Operations', async () => {
    const inventory = await openInventoryPermission({
      notifications: true,
      notifications_operations: true,
      notifications_inventory: false
    });
    expect(inventory).not.toBeChecked();
  });

  it('persists Inventory explicitly when a modern form is saved', async () => {
    const inventory = await openInventoryPermission({
      notifications: true,
      notifications_operations: false
    });

    fireEvent.click(inventory);
    expect(inventory).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(mocks.updateStaffUserService).toHaveBeenCalledWith(
      'LIC-PHASE5',
      'staff-inventory',
      expect.objectContaining({
        permissions: expect.objectContaining({
          notifications: true,
          notifications_inventory: true,
          notifications_operations: false
        })
      })
    ));
  });

  it('keeps Inventory and Operations toggles independent', async () => {
    const inventory = await openInventoryPermission({
      notifications: true,
      notifications_inventory: true,
      notifications_operations: true
    });
    const operations = screen.getByRole('checkbox', { name: /Mensajes de operaciones/ });

    fireEvent.click(inventory);
    expect(inventory).not.toBeChecked();
    expect(operations).toBeChecked();

    fireEvent.click(operations);
    expect(inventory).not.toBeChecked();
    expect(operations).not.toBeChecked();
  });

  it('includes Inventory in Supervisor but does not enable notification center for other role templates', async () => {
    mocks.listStaffUsersService.mockResolvedValue({ success: true, data: [] });
    render(<StaffUsersSettings licenseKey="LIC-PHASE5" />);

    await waitFor(() => expect(screen.getByRole('button', { name: /Nuevo staff/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Nuevo staff/ }));
    fireEvent.click(screen.getByText('Lanzo Nube', { selector: 'strong' }));

    const role = screen.getByLabelText('Rol');
    const master = screen.getByRole('checkbox', { name: /Centro de Notificaciones/ });
    const inventory = screen.getByRole('checkbox', { name: /Alertas de inventario/ });

    for (const roleName of ['staff', 'cashier', 'waiter']) {
      fireEvent.change(role, { target: { value: roleName } });
      expect(master).not.toBeChecked();
      expect(inventory).not.toBeChecked();
      expect(inventory).toBeDisabled();
    }

    fireEvent.change(role, { target: { value: 'supervisor' } });
    expect(master).toBeChecked();
    expect(inventory).toBeChecked();
    expect(inventory).not.toBeDisabled();
  });
});
