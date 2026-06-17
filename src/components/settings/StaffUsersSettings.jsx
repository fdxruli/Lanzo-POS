import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Save, UserCheck, UserX } from 'lucide-react';
import {
  createStaffUserService,
  listStaffUsersService,
  updateStaffUserService
} from '../../services/licenseService';
import { showMessageModal } from '../../services/utils';

const PERMISSION_LABELS = {
  pos: 'Punto de venta',
  orders: 'Pedidos',
  products: 'Productos',
  customers: 'Clientes',
  reports: 'Reportes',
  settings: 'Configuracion',
  devices: 'Dispositivos',
  license: 'Licencia',
  inventory: 'Inventario',
  cash_register: 'Caja',
  discounts: 'Descuentos',
  refunds: 'Devoluciones',
  ecommerce: 'Ecommerce',
  sync: 'Sincronizacion'
};

const EMPTY_PERMISSIONS = Object.fromEntries(
  Object.keys(PERMISSION_LABELS).map((permission) => [permission, false])
);

const ROLE_TEMPLATES = {
  staff: { ...EMPTY_PERMISSIONS, pos: true },
  waiter: { ...EMPTY_PERMISSIONS, pos: true, orders: true },
  cashier: {
    ...EMPTY_PERMISSIONS,
    pos: true,
    orders: true,
    customers: true,
    cash_register: true,
    discounts: true
  },
  supervisor: {
    ...EMPTY_PERMISSIONS,
    pos: true,
    orders: true,
    products: true,
    customers: true,
    reports: true,
    inventory: true,
    cash_register: true,
    discounts: true,
    refunds: true,
    sync: true
  },
  custom: { ...EMPTY_PERMISSIONS }
};

const ROLE_OPTIONS = ['staff', 'cashier', 'waiter', 'supervisor', 'custom'];

const normalizePermissions = (permissions = {}) => ({
  ...EMPTY_PERMISSIONS,
  ...permissions
});

const createEmptyForm = () => ({
  username: '',
  display_name: '',
  role_name: 'cashier',
  password: '',
  permissions: ROLE_TEMPLATES.cashier
});

export default function StaffUsersSettings({ licenseKey }) {
  const [staffUsers, setStaffUsers] = useState([]);
  const [form, setForm] = useState(createEmptyForm);
  const [editing, setEditing] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const permissionKeys = useMemo(() => Object.keys(PERMISSION_LABELS), []);

  const loadStaffUsers = useCallback(async () => {
    if (!licenseKey) return;

    setIsLoading(true);
    setErrorMessage('');

    const result = await listStaffUsersService(licenseKey);

    if (result.success) {
      setStaffUsers(result.data || []);
    } else {
      setErrorMessage(result.message || 'No se pudieron cargar usuarios staff.');
    }

    setIsLoading(false);
  }, [licenseKey]);

  useEffect(() => {
    loadStaffUsers();
  }, [loadStaffUsers]);

  const updateForm = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const applyRoleTemplate = (roleName) => {
    setForm((current) => ({
      ...current,
      role_name: roleName,
      permissions: normalizePermissions(ROLE_TEMPLATES[roleName] || current.permissions)
    }));
  };

  const togglePermission = (permission) => {
    setForm((current) => ({
      ...current,
      role_name: 'custom',
      permissions: {
        ...current.permissions,
        [permission]: !current.permissions?.[permission]
      }
    }));
  };

  const startEdit = (staffUser) => {
    setEditing(staffUser);
    setForm({
      username: staffUser.username || '',
      display_name: staffUser.display_name || '',
      role_name: staffUser.role_name || 'custom',
      password: '',
      permissions: normalizePermissions(staffUser.permissions)
    });
  };

  const resetForm = () => {
    setEditing(null);
    setForm(createEmptyForm());
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsSaving(true);
    setErrorMessage('');

    const payload = {
      username: form.username.trim(),
      display_name: form.display_name.trim(),
      role_name: form.role_name,
      password: form.password,
      permissions: normalizePermissions(form.permissions)
    };

    const result = editing
      ? await updateStaffUserService(licenseKey, editing.id, {
        display_name: payload.display_name,
        role_name: payload.role_name,
        permissions: payload.permissions,
        is_active: editing.is_active !== false,
        new_password: payload.password || null
      })
      : await createStaffUserService(licenseKey, payload);

    if (result.success) {
      showMessageModal(editing ? 'Usuario staff actualizado.' : 'Usuario staff creado.', null, { type: 'success' });
      resetForm();
      await loadStaffUsers();
    } else {
      setErrorMessage(result.message || 'No se pudo guardar usuario staff.');
    }

    setIsSaving(false);
  };

  const toggleActive = async (staffUser) => {
    const result = await updateStaffUserService(licenseKey, staffUser.id, {
      display_name: staffUser.display_name,
      role_name: staffUser.role_name || 'staff',
      permissions: normalizePermissions(staffUser.permissions),
      is_active: staffUser.is_active === false,
      new_password: null
    });

    if (result.success) {
      await loadStaffUsers();
    } else {
      showMessageModal(result.message || 'No se pudo actualizar estado staff.', null, { type: 'error' });
    }
  };

  return (
    <section className="staff-users-section" aria-labelledby="staff-users-title">
      <div className="staff-users-header">
        <div>
          <h4 id="staff-users-title">Usuarios staff</h4>
          <p>Administra usuarios y permisos por modulo para dispositivos staff.</p>
        </div>
        <button type="button" className="btn btn-cancel" onClick={loadStaffUsers} disabled={isLoading}>
          <RefreshCw size={16} />
          Actualizar
        </button>
      </div>

      {errorMessage && (
        <div className="staff-users-error" role="alert">
          {errorMessage}
        </div>
      )}

      <form className="staff-user-form" onSubmit={handleSubmit}>
        <div className="settings-grid">
          <div className="form-group">
            <label className="form-label" htmlFor="staff-username">Usuario</label>
            <input
              id="staff-username"
              className="form-input"
              value={form.username}
              onChange={(event) => updateForm('username', event.target.value)}
              disabled={Boolean(editing) || isSaving}
              required={!editing}
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="staff-display-name">Nombre</label>
            <input
              id="staff-display-name"
              className="form-input"
              value={form.display_name}
              onChange={(event) => updateForm('display_name', event.target.value)}
              disabled={isSaving}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="staff-role">Rol</label>
            <select
              id="staff-role"
              className="form-input"
              value={form.role_name}
              onChange={(event) => applyRoleTemplate(event.target.value)}
              disabled={isSaving}
            >
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>{role}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="staff-password">
              {editing ? 'Nueva contrasena' : 'Contrasena temporal'}
            </label>
            <input
              id="staff-password"
              className="form-input"
              type="password"
              value={form.password}
              onChange={(event) => updateForm('password', event.target.value)}
              disabled={isSaving}
              required={!editing}
              minLength={6}
            />
          </div>
        </div>

        <div className="staff-permissions-grid">
          {permissionKeys.map((permission) => (
            <label key={permission} className="staff-permission-toggle">
              <input
                type="checkbox"
                checked={form.permissions?.[permission] === true}
                onChange={() => togglePermission(permission)}
                disabled={isSaving}
              />
              <span>{PERMISSION_LABELS[permission]}</span>
            </label>
          ))}
        </div>

        <div className="staff-user-form-actions">
          {editing && (
            <button type="button" className="btn btn-cancel" onClick={resetForm} disabled={isSaving}>
              Cancelar
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={isSaving}>
            {editing ? <Save size={16} /> : <Plus size={16} />}
            {isSaving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Crear staff'}
          </button>
        </div>
      </form>

      <div className="staff-users-list">
        {isLoading ? (
          <p className="form-help-text">Cargando usuarios staff...</p>
        ) : staffUsers.length === 0 ? (
          <p className="form-help-text">Aun no hay usuarios staff.</p>
        ) : (
          staffUsers.map((staffUser) => (
            <div className="staff-user-row" key={staffUser.id}>
              <div>
                <strong>{staffUser.display_name || staffUser.username}</strong>
                <span>@{staffUser.username} · {staffUser.role_name || 'staff'}</span>
                <small>
                  Ultimo login: {staffUser.last_login_at ? new Date(staffUser.last_login_at).toLocaleString() : 'Sin login'}
                </small>
              </div>
              <div className="staff-user-row-actions">
                <span className={`staff-status-badge ${staffUser.is_active === false ? 'inactive' : 'active'}`}>
                  {staffUser.is_active === false ? 'Inactivo' : 'Activo'}
                </span>
                <button type="button" className="btn btn-cancel" onClick={() => startEdit(staffUser)}>
                  Editar
                </button>
                <button type="button" className="btn btn-cancel" onClick={() => toggleActive(staffUser)}>
                  {staffUser.is_active === false ? <UserCheck size={16} /> : <UserX size={16} />}
                  {staffUser.is_active === false ? 'Activar' : 'Desactivar'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
