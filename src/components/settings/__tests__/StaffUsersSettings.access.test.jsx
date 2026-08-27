// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createStaffUserService: vi.fn(),
  listStaffUsersService: vi.fn(),
  updateStaffUserService: vi.fn(),
  showMessageModal: vi.fn(),
  dismissForm: null
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
  useDismissibleHistoryLayer: ({ onDismiss }) => {
    mocks.dismissForm = onDismiss;
    return onDismiss;
  }
}));

import StaffUsersSettings from '../StaffUsersSettings';

const existingUser = {
  id: 'staff-1',
  username: 'ana',
  display_name: 'Ana Garcia',
  role_name: 'cashier',
  is_active: true,
  last_login_at: '2026-08-26T18:00:00.000Z',
  permissions: {
    pos: true,
    customers: true,
    cash_register: true
  }
};

const createDeferred = () => {
  let resolve;
  const promise = new Promise((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
};

const createdUser = {
  id: 'staff-2',
  username: 'nuevo',
  display_name: 'Nuevo Staff',
  role_name: 'cashier',
  is_active: true,
  last_login_at: null,
  permissions: {
    pos: true,
    cash_register: true
  }
};

const canonicalUpdatedUser = {
  id: existingUser.id,
  username: existingUser.username,
  display_name: 'Ana Actualizada',
  role_name: 'cashier',
  permissions: {
    ...existingUser.permissions,
    reports: true
  },
  is_active: true,
  updated_at: '2026-08-27T00:00:00.000Z'
};

const canonicalDeactivatedUser = {
  id: existingUser.id,
  username: existingUser.username,
  display_name: existingUser.display_name,
  role_name: existingUser.role_name,
  permissions: existingUser.permissions,
  is_active: false,
  updated_at: '2026-08-27T00:00:00.000Z'
};

describe('StaffUsersSettings list-first administration', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dismissForm = null;
    mocks.listStaffUsersService.mockResolvedValue({ success: true, data: [existingUser] });
    mocks.createStaffUserService.mockResolvedValue({ success: true, data: { id: 'staff-2' } });
    mocks.updateStaffUserService.mockResolvedValue({ success: true });
  });

  it('shows the existing Staff list before mounting the create form', async () => {
    render(<StaffUsersSettings licenseKey="LIC-1" />);

    expect(screen.getByRole('heading', { name: 'Usuarios staff' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nuevo staff/ })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Operacion')).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('Ana Garcia')).toBeInTheDocument());
    expect(screen.getByText('@ana · Cajero')).toBeInTheDocument();
    expect(screen.getByText('Activo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Desactivar/ })).toBeInTheDocument();
    expect(mocks.listStaffUsersService).toHaveBeenCalledTimes(1);
  });

  it('preserves loaded rows during an explicit refresh and performs one list call', async () => {
    const refresh = createDeferred();
    mocks.listStaffUsersService.mockReset();
    mocks.listStaffUsersService
      .mockResolvedValueOnce({ success: true, data: [existingUser] })
      .mockReturnValueOnce(refresh.promise);

    render(<StaffUsersSettings licenseKey="LIC-1" />);
    await waitFor(() => expect(screen.getByText('Ana Garcia')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));

    expect(mocks.listStaffUsersService).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Ana Garcia')).toBeInTheDocument();
    expect(screen.queryByText('Cargando usuarios staff...')).not.toBeInTheDocument();

    refresh.resolve({ success: true, data: [existingUser] });
    await waitFor(() => expect(screen.getByText('Ana Garcia')).toBeInTheDocument());
  });

  it('deduplicates the initial list request under StrictMode effect replay', async () => {
    render(
      <StrictMode>
        <StaffUsersSettings licenseKey="LIC-1" />
      </StrictMode>
    );

    await waitFor(() => expect(screen.getByText('Ana Garcia')).toBeInTheDocument());
    expect(mocks.listStaffUsersService).toHaveBeenCalledTimes(1);
  });

  it('upserts a canonical created Staff row without reconciliation', async () => {
    mocks.createStaffUserService.mockResolvedValue({ success: true, staff_user: createdUser });

    render(<StaffUsersSettings licenseKey="LIC-1" />);
    await waitFor(() => expect(screen.getByText('Ana Garcia')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Nuevo staff/ }));

    fireEvent.change(screen.getByLabelText('Usuario'), { target: { value: 'nuevo' } });
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Nuevo Staff' } });
    fireEvent.change(screen.getByLabelText('Contrasena temporal'), { target: { value: 'secret1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear staff' }));

    await waitFor(() => expect(screen.getByText('Nuevo Staff')).toBeInTheDocument());
    expect(mocks.createStaffUserService).toHaveBeenCalledTimes(1);
    expect(mocks.listStaffUsersService).toHaveBeenCalledTimes(1);
  });

  it('upserts a canonical edited Staff row without reconciliation', async () => {
    mocks.updateStaffUserService.mockResolvedValue({ success: true, staff_user: canonicalUpdatedUser });

    render(<StaffUsersSettings licenseKey="LIC-1" />);
    await waitFor(() => expect(screen.getByText('Ana Garcia')).toBeInTheDocument());
    const originalLastLogin = screen.getByText(/Ultimo login:/).textContent;
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ana Actualizada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(screen.getByText('Ana Actualizada')).toBeInTheDocument());
    expect(screen.getByText(originalLastLogin)).toBeInTheDocument();
    expect(screen.queryByText('Ultimo login: Sin login')).not.toBeInTheDocument();
    expect(mocks.updateStaffUserService).toHaveBeenCalledTimes(1);
    expect(mocks.listStaffUsersService).toHaveBeenCalledTimes(1);
  });

  it('upserts canonical activation changes without reconciliation', async () => {
    mocks.updateStaffUserService.mockResolvedValue({ success: true, staff_user: canonicalDeactivatedUser });

    render(<StaffUsersSettings licenseKey="LIC-1" />);
    await waitFor(() => expect(screen.getByText('Ana Garcia')).toBeInTheDocument());
    const originalLastLogin = screen.getByText(/Ultimo login:/).textContent;
    fireEvent.click(screen.getByRole('button', { name: /Desactivar/ }));

    await waitFor(() => expect(screen.getByText('Inactivo')).toBeInTheDocument());
    expect(screen.getByText(originalLastLogin)).toBeInTheDocument();
    expect(screen.queryByText('Ultimo login: Sin login')).not.toBeInTheDocument();
    expect(mocks.updateStaffUserService).toHaveBeenCalledTimes(1);
    expect(mocks.listStaffUsersService).toHaveBeenCalledTimes(1);
  });

  it('lets an explicit canonical null replace a previously known field', async () => {
    mocks.updateStaffUserService.mockResolvedValue({
      success: true,
      staff_user: {
        ...canonicalUpdatedUser,
        last_login_at: null
      }
    });

    render(<StaffUsersSettings licenseKey="LIC-1" />);
    await waitFor(() => expect(screen.getByText('Ana Garcia')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ana Actualizada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(screen.getByText('Ultimo login: Sin login')).toBeInTheDocument());
    expect(mocks.updateStaffUserService).toHaveBeenCalledTimes(1);
    expect(mocks.listStaffUsersService).toHaveBeenCalledTimes(1);
  });

  it('performs exactly one reconciliation when a successful mutation lacks a canonical row', async () => {
    mocks.listStaffUsersService.mockReset();
    mocks.listStaffUsersService
      .mockResolvedValueOnce({ success: true, data: [existingUser] })
      .mockResolvedValueOnce({ success: true, data: [existingUser, createdUser] });
    mocks.createStaffUserService.mockResolvedValue({ success: true, staff_user: null });

    render(<StaffUsersSettings licenseKey="LIC-1" />);
    await waitFor(() => expect(screen.getByText('Ana Garcia')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Nuevo staff/ }));
    fireEvent.change(screen.getByLabelText('Usuario'), { target: { value: 'nuevo' } });
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Nuevo Staff' } });
    fireEvent.change(screen.getByLabelText('Contrasena temporal'), { target: { value: 'secret1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear staff' }));

    await waitFor(() => expect(screen.getByText('Nuevo Staff')).toBeInTheDocument());
    expect(mocks.listStaffUsersService).toHaveBeenCalledTimes(2);
  });

  it('does not let an older list response overwrite a newer canonical mutation', async () => {
    const initialList = createDeferred();
    mocks.listStaffUsersService.mockReset();
    mocks.listStaffUsersService.mockReturnValueOnce(initialList.promise);
    mocks.createStaffUserService.mockResolvedValue({ success: true, staff_user: createdUser });

    render(<StaffUsersSettings licenseKey="LIC-1" />);
    expect(mocks.listStaffUsersService).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Nuevo staff/ }));
    fireEvent.change(screen.getByLabelText('Usuario'), { target: { value: 'nuevo' } });
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Nuevo Staff' } });
    fireEvent.change(screen.getByLabelText('Contrasena temporal'), { target: { value: 'secret1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear staff' }));

    await waitFor(() => expect(screen.getByText('Nuevo Staff')).toBeInTheDocument());
    initialList.resolve({ success: true, data: [existingUser] });

    await waitFor(() => expect(screen.getByText('Nuevo Staff')).toBeInTheDocument());
    expect(mocks.listStaffUsersService).toHaveBeenCalledTimes(1);
  });

  it('opens the create form on demand in an accessible canonical modal', async () => {
    render(<StaffUsersSettings licenseKey="LIC-1" />);
    await waitFor(() => expect(screen.getByText('Ana Garcia')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Nuevo staff/ }));

    expect(screen.getByRole('dialog', { name: 'Nuevo usuario staff' })).toBeInTheDocument();
    expect(screen.getByLabelText('Usuario')).toHaveValue('');
    expect(screen.getByLabelText('Nombre')).toHaveValue('');
    expect(screen.getByLabelText('Contrasena temporal')).toBeRequired();
    expect(screen.getByRole('button', { name: 'Cerrar formulario de usuario staff' })).toBeInTheDocument();
  });

  it('opens the same form pre-populated when editing an existing user', async () => {
    render(<StaffUsersSettings licenseKey="LIC-1" />);
    await waitFor(() => expect(screen.getByText('Ana Garcia')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));

    expect(screen.getByRole('dialog', { name: 'Editar usuario staff' })).toBeInTheDocument();
    expect(screen.getByLabelText('Usuario')).toHaveValue('ana');
    expect(screen.getByLabelText('Usuario')).toBeDisabled();
    expect(screen.getByLabelText('Nombre')).toHaveValue('Ana Garcia');
    expect(screen.getByLabelText('Nueva contrasena')).toHaveValue('');
  });

  it('keeps the create payload semantics and closes after a successful save', async () => {
    render(<StaffUsersSettings licenseKey="LIC-1" />);
    await waitFor(() => expect(screen.getByText('Ana Garcia')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Nuevo staff/ }));

    fireEvent.change(screen.getByLabelText('Usuario'), { target: { value: ' nuevo ' } });
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: ' Nuevo Staff ' } });
    fireEvent.change(screen.getByLabelText('Contrasena temporal'), { target: { value: 'secret1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear staff' }));

    await waitFor(() => expect(mocks.createStaffUserService).toHaveBeenCalledWith(
      'LIC-1',
      expect.objectContaining({
        username: 'nuevo',
        display_name: 'Nuevo Staff',
        role_name: 'cashier',
        password: 'secret1',
        permissions: expect.objectContaining({ pos: true, cash_register: true })
      })
    ));
    expect(mocks.updateStaffUserService).not.toHaveBeenCalled();
    expect(mocks.showMessageModal).toHaveBeenCalledWith('Usuario staff creado.', null, { type: 'success' });
    expect(mocks.dismissForm).toEqual(expect.any(Function));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('keeps editing payload semantics and preserves the active-state update behavior', async () => {
    render(<StaffUsersSettings licenseKey="LIC-1" />);
    await waitFor(() => expect(screen.getByText('Ana Garcia')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ana Actualizada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(mocks.updateStaffUserService).toHaveBeenCalledWith(
      'LIC-1',
      'staff-1',
      expect.objectContaining({
        display_name: 'Ana Actualizada',
        role_name: 'cashier',
        is_active: true,
        new_password: null,
        permissions: expect.objectContaining({ pos: true })
      })
    ));

    expect(mocks.showMessageModal).toHaveBeenCalledWith('Usuario staff actualizado.', null, { type: 'success' });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Desactivar/ }));
    await waitFor(() => expect(mocks.updateStaffUserService).toHaveBeenCalledWith(
      'LIC-1',
      'staff-1',
      expect.objectContaining({ is_active: false, new_password: null })
    ));
  });

  it('toggles both permission groups safely and preserves notification master/detail behavior', async () => {
    render(<StaffUsersSettings licenseKey="LIC-1" />);
    await waitFor(() => expect(screen.getByText('Ana Garcia')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Nuevo staff/ }));

    const operationDetails = screen.getByText('Operacion', { selector: 'strong' }).closest('details');
    const cloudDetails = screen.getByText('Lanzo Nube', { selector: 'strong' }).closest('details');
    expect(operationDetails).not.toHaveAttribute('open');
    expect(cloudDetails).not.toHaveAttribute('open');

    fireEvent.click(screen.getByText('Operacion', { selector: 'strong' }));
    expect(operationDetails).toHaveAttribute('open');
    expect(screen.getByRole('checkbox', { name: 'Punto de venta' })).toBeInTheDocument();

    fireEvent.click(screen.getByText('Operacion', { selector: 'strong' }));
    expect(operationDetails).not.toHaveAttribute('open');

    fireEvent.click(screen.getByText('Operacion', { selector: 'strong' }));
    expect(operationDetails).toHaveAttribute('open');

    fireEvent.click(screen.getByText('Lanzo Nube', { selector: 'strong' }));
    expect(cloudDetails).toHaveAttribute('open');

    fireEvent.click(screen.getByText('Lanzo Nube', { selector: 'strong' }));
    expect(cloudDetails).not.toHaveAttribute('open');

    fireEvent.click(screen.getByText('Lanzo Nube', { selector: 'strong' }));
    expect(cloudDetails).toHaveAttribute('open');

    const notificationMaster = screen.getByRole('checkbox', { name: /Centro de Notificaciones/ });
    const ecommerceDetail = screen.getByRole('checkbox', { name: /Mensajes de pedidos online/ });
    expect(notificationMaster).not.toBeChecked();
    expect(ecommerceDetail).toBeDisabled();

    fireEvent.click(notificationMaster);
    expect(notificationMaster).toBeChecked();
    expect(ecommerceDetail).toBeChecked();
    expect(ecommerceDetail).not.toBeDisabled();

    fireEvent.click(notificationMaster);
    expect(notificationMaster).not.toBeChecked();
    expect(ecommerceDetail).toBeDisabled();
  });
});
