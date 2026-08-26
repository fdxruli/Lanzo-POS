import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Save, UserCheck, UserX, X } from 'lucide-react';
import {
  createStaffUserService,
  listStaffUsersService,
  updateStaffUserService
} from '../../services/licenseService';
import { showMessageModal } from '../../services/utils';
import { useDismissibleHistoryLayer } from '../../hooks/useDismissibleHistoryLayer';

const NOTIFICATION_DETAIL_PERMISSIONS = [
  'notifications_ecommerce',
  'notifications_support',
  'notifications_license',
  'notifications_operations',
  'notifications_system'
];

const PERMISSION_LABELS = {
  pos: 'Punto de venta',
  orders: 'Pedidos',
  products: 'Productos',
  customers: 'Clientes',
  reports: 'Reportes',
  notifications: 'Centro de Notificaciones',
  notifications_ecommerce: 'Mensajes de pedidos online',
  notifications_support: 'Mensajes de soporte',
  notifications_license: 'Mensajes de licencia',
  notifications_operations: 'Mensajes de operaciones',
  notifications_system: 'Mensajes de sistema',
  support_center: 'Soporte Lanzo',
  ai_agents: 'Agentes IA',
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

const PERMISSION_DESCRIPTIONS = {
  notifications: 'Interruptor maestro. Al desactivarlo, el staff no puede abrir el Centro de Notificaciones.',
  notifications_ecommerce: 'Avisos de nuevos pedidos online y eventos del canal ecommerce.',
  notifications_support: 'Avisos de respuestas y cambios de solicitudes de soporte.',
  notifications_license: 'Vencimiento, renovacion, plan y eventos importantes de la licencia.',
  notifications_operations: 'Caja, sincronizacion, inventario y otras alertas operativas del negocio.',
  notifications_system: 'Mensajes generales de Lanzo que no pertenecen a otra categoria.',
  support_center: 'Permite crear y responder solicitudes de soporte desde Lanzo Nube.'
};

const PERMISSION_GROUPS = [
  {
    title: 'Operacion',
    permissions: [
      'pos',
      'orders',
      'products',
      'customers',
      'reports',
      'settings',
      'devices',
      'license',
      'inventory',
      'cash_register',
      'discounts',
      'refunds',
      'ecommerce',
      'sync'
    ]
  },
  {
    title: 'Lanzo Nube',
    permissions: [
      'notifications',
      ...NOTIFICATION_DETAIL_PERMISSIONS,
      'support_center',
      'ai_agents'
    ]
  }
];

const getPermissionGroupTitle = (permission) => PERMISSION_GROUPS.find((group) => (
  group.permissions.includes(permission)
))?.title;

const EMPTY_PERMISSIONS = Object.fromEntries(
  Object.keys(PERMISSION_LABELS).map((permission) => [permission, false])
);

const ROLE_LABELS = {
  staff: 'Personal',
  cashier: 'Cajero',
  waiter: 'Mesero',
  supervisor: 'Encargado',
  custom: 'Personalizado'
};

const ROLE_DESCRIPTIONS = {
  staff: 'Acceso básico al punto de venta.',
  cashier: 'Puede vender, cobrar y aplicar descuentos.',
  waiter: 'Pensado para tomar pedidos.',
  supervisor: 'Puede operar, revisar reportes, inventario, caja, notificaciones y agentes IA.',
  custom: 'Permisos configurados manualmente.'
};

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
    notifications: true,
    notifications_ecommerce: true,
    notifications_support: true,
    notifications_license: true,
    notifications_operations: true,
    notifications_system: true,
    support_center: true,
    ai_agents: true,
    inventory: true,
    cash_register: true,
    discounts: true,
    refunds: true,
    sync: true
  },
  custom: { ...EMPTY_PERMISSIONS }
};

const ROLE_OPTIONS = ['staff', 'cashier', 'waiter', 'supervisor', 'custom'];
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

const normalizePermissions = (permissions = {}) => {
  const normalized = {
    ...EMPTY_PERMISSIONS,
    ...permissions
  };

  // Compatibility for staff created before category-level notification flags.
  // An existing master notifications=true keeps access to every category until
  // an admin explicitly saves granular switches.
  NOTIFICATION_DETAIL_PERMISSIONS.forEach((permission) => {
    if (!hasOwn(permissions, permission)) {
      normalized[permission] = permissions.notifications === true;
    }
  });

  return normalized;
};

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
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [openPermissionGroups, setOpenPermissionGroups] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const permissionGroups = useMemo(() => PERMISSION_GROUPS, []);

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
    setOpenPermissionGroups(roleName === 'custom'
      ? Object.fromEntries(PERMISSION_GROUPS.map((group) => [group.title, true]))
      : {});
  };

  const togglePermission = (permission) => {
    const groupTitle = getPermissionGroupTitle(permission);
    if (groupTitle) {
      setOpenPermissionGroups((current) => ({ ...current, [groupTitle]: true }));
    }

    setForm((current) => {
      const nextValue = current.permissions?.[permission] !== true;
      const nextPermissions = {
        ...current.permissions,
        [permission]: nextValue
      };

      // Preserve the old, intuitive behavior when the master switch is first
      // enabled: all categories start enabled and the admin can narrow them.
      if (permission === 'notifications' && nextValue) {
        NOTIFICATION_DETAIL_PERMISSIONS.forEach((detailPermission) => {
          nextPermissions[detailPermission] = true;
        });
      }

      return {
        ...current,
        role_name: 'custom',
        permissions: nextPermissions
      };
    });
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
    setOpenPermissionGroups(staffUser.role_name === 'custom'
      ? Object.fromEntries(PERMISSION_GROUPS.map((group) => [group.title, true]))
      : {});
    setErrorMessage('');
    setIsFormOpen(true);
  };

  const openCreate = () => {
    setEditing(null);
    setForm(createEmptyForm());
    setOpenPermissionGroups({});
    setErrorMessage('');
    setIsFormOpen(true);
  };

  const closeForm = useCallback(() => {
    setIsFormOpen(false);
    setEditing(null);
    setForm(createEmptyForm());
    setOpenPermissionGroups({});
  }, []);

  const dismissForm = useDismissibleHistoryLayer({
    isOpen: isFormOpen,
    onDismiss: closeForm,
    layerId: 'staff-user-form'
  });

  useEffect(() => {
    if (!isFormOpen) return undefined;

    const handleEscape = (event) => {
      if (event.key === 'Escape' && !isSaving) dismissForm();
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [dismissForm, isFormOpen, isSaving]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSaving) return;
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
      dismissForm();
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
        <div className="staff-users-header-copy">
          <h4 id="staff-users-title">Usuarios staff</h4>
          <p>Administra el acceso de los dispositivos staff.</p>
        </div>
        <div className="staff-users-header-actions">
          <span className="staff-users-count" aria-live="polite">{staffUsers.length} usuarios</span>
          <button type="button" className="btn btn-cancel" onClick={loadStaffUsers} disabled={isLoading}>
            <RefreshCw size={16} aria-hidden="true" />
            Actualizar
          </button>
          <button type="button" className="btn btn-primary staff-new-user-button" onClick={openCreate}>
            <Plus size={16} aria-hidden="true" />
            Nuevo staff
          </button>
        </div>
      </div>

      {errorMessage && !isFormOpen && (
        <div className="staff-users-error" role="alert">
          {errorMessage}
        </div>
      )}

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
                <span>
                  @{staffUser.username} · {ROLE_LABELS[staffUser.role_name] || 'Personal'}
                </span>
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
                  {staffUser.is_active === false
                    ? <UserCheck size={16} aria-hidden="true" />
                    : <UserX size={16} aria-hidden="true" />}
                  {staffUser.is_active === false ? 'Activar' : 'Desactivar'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {isFormOpen && (
        <div
          className="ui-modal ui-modal--high staff-user-modal-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isSaving) dismissForm();
          }}
        >
          <div
            className="ui-modal__content ui-modal__content--lg staff-user-modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="staff-user-form-title"
            aria-describedby="staff-user-form-help"
            aria-busy={isSaving}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="ui-modal__header staff-user-modal-header">
              <div>
                <h2 id="staff-user-form-title" className="ui-modal__title">
                  {editing ? 'Editar usuario staff' : 'Nuevo usuario staff'}
                </h2>
                <p id="staff-user-form-help" className="ui-modal__subtitle">
                  {editing
                    ? 'Actualiza los datos y permisos de este usuario.'
                    : 'Crea un acceso para un dispositivo staff.'}
                </p>
              </div>
              <button
                type="button"
                className="ui-icon-button staff-user-modal-close"
                onClick={dismissForm}
                disabled={isSaving}
                aria-label="Cerrar formulario de usuario staff"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </header>

            {errorMessage && (
              <div className="staff-users-error staff-user-modal-error" role="alert">
                {errorMessage}
              </div>
            )}

            <form className="staff-user-modal-form" onSubmit={handleSubmit}>
              <div className="ui-modal__body staff-user-modal-body">
                <div className="settings-grid">
                  <div className="form-group">
                    <label className="form-label" htmlFor="staff-username">Usuario</label>
                    <input
                      id="staff-username"
                      name="username"
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
                      name="display_name"
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
                      name="role_name"
                      className="form-input"
                      value={form.role_name}
                      onChange={(event) => applyRoleTemplate(event.target.value)}
                      disabled={isSaving}
                    >
                      {ROLE_OPTIONS.map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABELS[role] || role}
                        </option>
                      ))}
                    </select>
                    {ROLE_DESCRIPTIONS[form.role_name] && (
                      <small className="form-help-text">{ROLE_DESCRIPTIONS[form.role_name]}</small>
                    )}
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="staff-password">
                      {editing ? 'Nueva contrasena' : 'Contrasena temporal'}
                    </label>
                    <input
                      id="staff-password"
                      name="password"
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

                <div className="staff-permissions-groups">
                  {permissionGroups.map((group) => {
                    const enabledPermissions = group.permissions.filter((permission) => (
                      form.permissions?.[permission] === true
                    )).length;

                    return (
                      <details
                        key={group.title}
                        className="staff-permissions-disclosure"
                        open={Boolean(openPermissionGroups[group.title])}
                        onToggle={(event) => {
                          const isOpen = event.currentTarget.open;

                          setOpenPermissionGroups((current) => {
                            if (Boolean(current[group.title]) === isOpen) return current;

                            return {
                              ...current,
                              [group.title]: isOpen
                            };
                          });
                        }}
                      >
                        <summary className="staff-permissions-summary">
                          <span>
                            <strong>{group.title}</strong>
                            <small>{enabledPermissions} de {group.permissions.length} permisos activos</small>
                          </span>
                        </summary>
                        <fieldset className="staff-permissions-group">
                          <legend className="sr-only">{group.title}</legend>
                          <div className="staff-permissions-grid">
                            {group.permissions.map((permission) => {
                              const isNotificationDetail = NOTIFICATION_DETAIL_PERMISSIONS.includes(permission);
                              const isDisabled = isSaving || (
                                isNotificationDetail && form.permissions?.notifications !== true
                              );

                              return (
                                <label key={permission} className="staff-permission-toggle">
                                  <input
                                    type="checkbox"
                                    checked={form.permissions?.[permission] === true}
                                    onChange={() => togglePermission(permission)}
                                    disabled={isDisabled}
                                  />
                                  <span>
                                    {PERMISSION_LABELS[permission]}
                                    {PERMISSION_DESCRIPTIONS[permission] && (
                                      <small>{PERMISSION_DESCRIPTIONS[permission]}</small>
                                    )}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </fieldset>
                      </details>
                    );
                  })}
                </div>
              </div>

              <footer className="ui-modal__actions staff-user-modal-actions">
                <button type="button" className="btn btn-cancel" onClick={dismissForm} disabled={isSaving}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={isSaving}>
                  {editing ? <Save size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
                  {isSaving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Crear staff'}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
