import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  'notifications_inventory',
  'notifications_operations',
  'notifications_system'
];

const PERMISSION_LABELS = {
  pos: 'Punto de venta',
  pos_credit_sales: 'Ventas fiadas',
  orders: 'Pedidos',
  products: 'Productos',
  customers: 'Clientes',
  reports: 'Reportes',
  notifications: 'Centro de Notificaciones',
  notifications_ecommerce: 'Mensajes de pedidos online',
  notifications_support: 'Mensajes de soporte',
  notifications_license: 'Mensajes de licencia',
  notifications_inventory: 'Alertas de inventario',
  notifications_operations: 'Mensajes de operaciones',
  notifications_system: 'Mensajes de sistema',
  support_center: 'Soporte Lanzo',
  ai_agents: 'Agentes IA',
  settings: 'Configuración (compatibilidad)',
  settings_data: 'Datos y Apariencia',
  settings_controls: 'Controles',
  settings_maintenance: 'Datos y Mantenimiento',
  settings_backup: 'Respaldos',
  devices: 'Dispositivos',
  license: 'Licencia y Rubros',
  inventory: 'Inventario',
  cash_register: 'Caja',
  discounts: 'Descuentos',
  refunds: 'Devoluciones',
  ecommerce: 'Ecommerce',
  sync: 'Sincronización'
};

const PERMISSION_DESCRIPTIONS = {
  pos: 'Permite abrir el Punto de venta. Otras acciones conservan sus permisos propios.',
  pos_credit_sales: 'Requiere Punto de venta. Permite realizar ventas que generen un saldo pendiente para un cliente. No controla el cobro de abonos ni modifica deudas existentes.',
  orders: 'Permite consultar y atender pedidos del negocio.',
  products: 'Permite acceder al catálogo de Productos. Las acciones de inventario conservan su autorización propia.',
  customers: 'Permite consultar y gestionar clientes desde el apartado Clientes.',
  reports: 'Permite consultar los reportes disponibles. Algunas exportaciones también requieren Sincronización.',
  notifications: 'Interruptor maestro. Al desactivarlo, el staff no puede abrir el Centro de Notificaciones.',
  notifications_ecommerce: 'Avisos de nuevos pedidos online y eventos del canal ecommerce.',
  notifications_support: 'Avisos de respuestas y cambios de solicitudes de soporte.',
  notifications_license: 'Vencimiento, renovacion, plan y eventos importantes de la licencia.',
  notifications_inventory: 'Alertas de stock bajo, productos agotados, vencimientos y productos próximos a caducar.',
  notifications_operations: 'Caja, sincronizacion y otras alertas operativas del negocio.',
  notifications_system: 'Mensajes generales de Lanzo que no pertenecen a otra categoria.',
  support_center: 'Permite crear y responder solicitudes de soporte desde Lanzo Nube.',
  ai_agents: 'Permite acceder a Agentes IA. Cada acción conserva sus confirmaciones y autorizaciones.',
  settings: 'Compatibilidad con accesos generales anteriores. Las secciones de Configuración respetan las claves granulares cuando existen.',
  settings_data: 'Permite cambiar los datos comerciales y la apariencia del negocio, incluidos sus datos de perfil.',
  settings_controls: 'Permite cambiar los controles operativos y las preferencias disponibles en Configuración → Controles.',
  license: 'Permite abrir Licencia y Rubros. La administración de usuarios Staff sigue reservada al Admin.',
  devices: 'Permite consultar el dispositivo actual. Cambiar capacidades o liberar cupos de la licencia sigue reservado al Admin.',
  settings_maintenance: 'Permite abrir Datos y Mantenimiento. Cada rutina conserva su permiso de Sincronización, Inventario o Reportes.',
  settings_backup: 'Permite configurar y ejecutar respaldos. La restauración permanece reservada al Administrador.',
  inventory: 'Permite acceder a Inventario. No habilita por sí solo Productos, Caja ni Reportes.',
  cash_register: 'Permite acceder a Caja según las acciones habilitadas para Staff.',
  discounts: 'Permite aplicar descuentos durante la venta, según los límites configurados.',
  refunds: 'Permite realizar devoluciones disponibles para Staff.',
  ecommerce: 'Permite abrir las funciones de Ecommerce disponibles para Staff; no activa servicios de la licencia.',
  sync: 'Permite ejecutar sincronizaciones y transferencias que usan esta autorización. No concede otros permisos por sí sola.'
};

const PERMISSION_GROUPS = [
  {
    title: 'Configuración',
    permissions: [
      'settings_data',
      'settings_controls',
      'license',
      'devices',
      'settings_maintenance',
      'settings_backup'
    ]
  },
  {
    title: 'Operación',
    permissions: [
      'pos',
      'pos_credit_sales',
      'orders',
      'products',
      'customers',
      'reports',
      'settings',
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
const PERMISSION_KEYS = Object.keys(PERMISSION_LABELS);

const GRANULAR_SETTINGS_PERMISSIONS = [
  'settings_data',
  'settings_controls',
  'settings_maintenance',
  'settings_backup'
];

const ROLE_LABELS = {
  staff: 'Personal',
  cashier: 'Cajero',
  waiter: 'Mesero',
  supervisor: 'Encargado',
  custom: 'Personalizado'
};

const ROLE_DESCRIPTIONS = {
  staff: 'Solo Punto de venta.',
  cashier: 'Punto de venta, pedidos, clientes, caja y descuentos.',
  waiter: 'Punto de venta y pedidos.',
  supervisor: 'Operación, productos, reportes, inventario, caja, notificaciones, soporte y Agentes IA. No incluye permisos de Configuración ni Ecommerce.',
  custom: 'Permisos configurados manualmente.'
};

const ROLE_TEMPLATES = {
  staff: { ...EMPTY_PERMISSIONS, pos: true, pos_credit_sales: true },
  waiter: { ...EMPTY_PERMISSIONS, pos: true, pos_credit_sales: true, orders: true },
  cashier: {
    ...EMPTY_PERMISSIONS,
    pos: true,
    pos_credit_sales: true,
    orders: true,
    customers: true,
    cash_register: true,
    discounts: true
  },
  supervisor: {
    ...EMPTY_PERMISSIONS,
    pos: true,
    pos_credit_sales: true,
    orders: true,
    products: true,
    customers: true,
    reports: true,
    notifications: true,
    notifications_ecommerce: true,
    notifications_support: true,
    notifications_license: true,
    notifications_inventory: true,
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
  const permissionRecord = Array.isArray(permissions)
    ? Object.fromEntries(permissions
      .filter((permission) => typeof permission === 'string')
      .map((permission) => [permission, true]))
    : permissions;
  const normalized = {
    ...EMPTY_PERMISSIONS,
    ...permissionRecord
  };

  // Rows from before section-level access existed keep the same grants. Once
  // any granular key is explicit, absent section keys stay off and no legacy
  // broad permission can restore one the Admin disabled.
  if (!GRANULAR_SETTINGS_PERMISSIONS.some((permission) => hasOwn(permissionRecord, permission))) {
    normalized.settings_data = permissionRecord?.settings === true;
    normalized.settings_controls = permissionRecord?.settings === true;
    normalized.settings_maintenance = permissionRecord?.sync === true
      || permissionRecord?.inventory === true;
    normalized.settings_backup = permissionRecord?.sync === true;
  }

  // Legacy Staff could create credit sales whenever they had POS access.
  // Preserve that effective grant only when the new key is absent; an
  // explicit false remains a withdrawal.
  normalized.pos_credit_sales = normalized.pos === true && (hasOwn(permissionRecord, 'pos_credit_sales')
    ? permissionRecord.pos_credit_sales === true
    : permissionRecord?.pos === true);

  // Compatibility for staff created before category-level notification flags.
  // Inventory inherited Operations before Phase 5, so preserve that exact
  // authority when the new key is absent.
  NOTIFICATION_DETAIL_PERMISSIONS.forEach((permission) => {
    if (hasOwn(permissions, permission)) return;

    if (permission === 'notifications_inventory' && hasOwn(permissions, 'notifications_operations')) {
      normalized[permission] = permissions.notifications_operations === true;
      return;
    }

    normalized[permission] = permissions.notifications === true;
  });

  return normalized;
};

const hasStableStaffUserId = (staffUser) => (
  staffUser
  && (typeof staffUser.id === 'string' || typeof staffUser.id === 'number')
  && String(staffUser.id).trim().length > 0
);

const upsertStaffUser = (currentUsers, canonicalStaffUser) => {
  if (!hasStableStaffUserId(canonicalStaffUser)) return currentUsers;

  const canonicalId = String(canonicalStaffUser.id);
  const existingIndex = currentUsers.findIndex((staffUser) => (
    hasStableStaffUserId(staffUser) && String(staffUser.id) === canonicalId
  ));

  if (existingIndex === -1) return [...currentUsers, canonicalStaffUser];

  return currentUsers.map((staffUser, index) => (
    index === existingIndex
      ? { ...staffUser, ...canonicalStaffUser }
      : staffUser
  ));
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
  const [hasLoaded, setHasLoaded] = useState(false);
  const mountedRef = useRef(true);
  const listRequestSequenceRef = useRef(0);
  const mutationVersionRef = useRef(0);
  const inFlightListRef = useRef(null);
  const contextGenerationRef = useRef(0);
  const licenseKeyRef = useRef(licenseKey);

  if (licenseKeyRef.current !== licenseKey) {
    licenseKeyRef.current = licenseKey;
    contextGenerationRef.current += 1;
    listRequestSequenceRef.current += 1;
    mutationVersionRef.current += 1;
    inFlightListRef.current = null;
  }

  const permissionGroups = useMemo(() => PERMISSION_GROUPS, []);
  const permissionSummary = useMemo(() => {
    const currentPermissions = normalizePermissions(form.permissions);
    const activeKeys = PERMISSION_KEYS.filter((permission) => currentPermissions[permission] === true);
    const activeByGroup = permissionGroups.map((group) => ({
      title: group.title,
      permissions: group.permissions
        .filter((permission) => currentPermissions[permission] === true)
        .map((permission) => PERMISSION_LABELS[permission])
    })).filter((group) => group.permissions.length > 0);

    if (!editing) {
      return {
        activeCount: activeKeys.length,
        activeByGroup,
        granted: [],
        withdrawn: [],
        unchangedActiveCount: 0,
        hasPendingChanges: false
      };
    }

    const originalPermissions = normalizePermissions(editing.permissions);
    const granted = PERMISSION_KEYS
      .filter((permission) => currentPermissions[permission] === true && originalPermissions[permission] !== true)
      .map((permission) => PERMISSION_LABELS[permission]);
    const withdrawn = PERMISSION_KEYS
      .filter((permission) => originalPermissions[permission] === true && currentPermissions[permission] !== true)
      .map((permission) => PERMISSION_LABELS[permission]);
    const unchangedActiveCount = PERMISSION_KEYS.filter((permission) => (
      originalPermissions[permission] === true && currentPermissions[permission] === true
    )).length;
    const hasPendingChanges = form.display_name.trim() !== (editing.display_name || '').trim()
      || form.role_name !== (editing.role_name || 'custom')
      || form.password.length > 0
      || granted.length > 0
      || withdrawn.length > 0;

    return {
      activeCount: activeKeys.length,
      activeByGroup,
      granted,
      withdrawn,
      unchangedActiveCount,
      hasPendingChanges
    };
  }, [editing, form.display_name, form.password, form.permissions, form.role_name, permissionGroups]);

  const loadStaffUsers = useCallback(async ({ force = false } = {}) => {
    if (!licenseKey) return null;
    if (inFlightListRef.current && !force) return inFlightListRef.current;

    const requestId = ++listRequestSequenceRef.current;
    const requestContextGeneration = contextGenerationRef.current;
    const requestMutationVersion = mutationVersionRef.current;

    setIsLoading(true);
    setErrorMessage('');

    const isCurrentRequest = () => (
      mountedRef.current
      && licenseKeyRef.current === licenseKey
      && contextGenerationRef.current === requestContextGeneration
      && listRequestSequenceRef.current === requestId
      && mutationVersionRef.current === requestMutationVersion
    );

    const request = (async () => {
      try {
        const result = await listStaffUsersService(licenseKey);

        if (isCurrentRequest()) {
          setHasLoaded(true);
          if (result.success) {
            setStaffUsers(Array.isArray(result.data) ? result.data : []);
          } else {
            setErrorMessage(result.message || 'No se pudieron cargar usuarios staff.');
          }
        }

        return result;
      } catch (error) {
        if (isCurrentRequest()) {
          setHasLoaded(true);
          setErrorMessage(error?.message || 'No se pudieron cargar usuarios staff.');
        }
        throw error;
      } finally {
        if (
          mountedRef.current
          && licenseKeyRef.current === licenseKey
          && contextGenerationRef.current === requestContextGeneration
          && listRequestSequenceRef.current === requestId
        ) {
          setIsLoading(false);
          inFlightListRef.current = null;
        }
      }
    })();

    inFlightListRef.current = request;
    return request;
  }, [licenseKey]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setStaffUsers([]);
    setHasLoaded(false);
    setIsLoading(false);
    setErrorMessage('');
    setIsFormOpen(false);
    setEditing(null);
    setForm(createEmptyForm());
    setOpenPermissionGroups({});
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

      if (permission === 'pos' && !nextValue) {
        nextPermissions.pos_credit_sales = false;
      }

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

  const commitSuccessfulMutation = async (result, mutationContextGeneration, mutationLicenseKey) => {
    const isCurrentContext = () => (
      mountedRef.current
      && licenseKeyRef.current === mutationLicenseKey
      && contextGenerationRef.current === mutationContextGeneration
    );

    if (!isCurrentContext()) return;

    mutationVersionRef.current += 1;
    if (hasStableStaffUserId(result?.staff_user)) {
      setStaffUsers((currentUsers) => upsertStaffUser(currentUsers, result.staff_user));
      setErrorMessage('');
      return;
    }

    await loadStaffUsers({ force: true });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    setErrorMessage('');
    const mutationContextGeneration = contextGenerationRef.current;
    const mutationLicenseKey = licenseKey;

    const payload = {
      username: form.username.trim(),
      display_name: form.display_name.trim(),
      role_name: form.role_name,
      password: form.password,
      permissions: normalizePermissions(form.permissions)
    };

    let saveConfirmed = false;
    try {
      const result = editing
        ? await updateStaffUserService(licenseKey, editing.id, {
          display_name: payload.display_name,
          role_name: payload.role_name,
          permissions: payload.permissions,
          is_active: editing.is_active !== false,
          new_password: payload.password || null
        })
        : await createStaffUserService(licenseKey, payload);

      if (
        !mountedRef.current
        || licenseKeyRef.current !== mutationLicenseKey
        || contextGenerationRef.current !== mutationContextGeneration
      ) return;

      if (result.success) {
        saveConfirmed = true;
        showMessageModal(editing ? 'Usuario staff actualizado.' : 'Usuario staff creado.', null, { type: 'success' });
        dismissForm();
        await commitSuccessfulMutation(result, mutationContextGeneration, mutationLicenseKey);
      } else {
        setErrorMessage(result.message || 'No se pudo guardar usuario staff.');
      }
    } catch (error) {
      if (
        mountedRef.current
        && licenseKeyRef.current === mutationLicenseKey
        && contextGenerationRef.current === mutationContextGeneration
      ) {
        setErrorMessage(saveConfirmed
          ? 'El guardado fue confirmado, pero no se pudo actualizar la lista. Pulsa Actualizar para volver a cargarla.'
          : error?.message || 'No se pudo guardar usuario staff.');
      }
    } finally {
      if (
        mountedRef.current
        && licenseKeyRef.current === mutationLicenseKey
        && contextGenerationRef.current === mutationContextGeneration
      ) {
        setIsSaving(false);
      }
    }
  };

  const toggleActive = async (staffUser) => {
    const mutationContextGeneration = contextGenerationRef.current;
    const mutationLicenseKey = licenseKey;
    const result = await updateStaffUserService(licenseKey, staffUser.id, {
      display_name: staffUser.display_name,
      role_name: staffUser.role_name || 'staff',
      permissions: normalizePermissions(staffUser.permissions),
      is_active: staffUser.is_active === false,
      new_password: null
    });

    if (
      !mountedRef.current
      || licenseKeyRef.current !== mutationLicenseKey
      || contextGenerationRef.current !== mutationContextGeneration
    ) return;

    if (result.success) {
      await commitSuccessfulMutation(result, mutationContextGeneration, mutationLicenseKey);
    } else {
      showMessageModal(result.message || 'No se pudo actualizar estado staff.', null, { type: 'error' });
    }
  };

  const isInitialLoading = isLoading && !hasLoaded && staffUsers.length === 0;

  return (
    <section className="staff-users-section" aria-labelledby="staff-users-title">
      <div className="staff-users-header">
        <div className="staff-users-header-copy">
          <h4 id="staff-users-title">Usuarios staff</h4>
          <p>Administra el acceso de los dispositivos staff.</p>
        </div>
        <div className="staff-users-header-actions">
          <span className="staff-users-count" aria-live="polite">{staffUsers.length} usuarios</span>
          <button
            type="button"
            className="btn btn-cancel"
            onClick={loadStaffUsers}
            disabled={isLoading}
            aria-busy={isLoading}
          >
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
        {isInitialLoading ? (
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
            className="ui-modal__content ui-modal__content--xl staff-user-modal-content"
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
                      aria-describedby="staff-role-description staff-role-template-note"
                    >
                      {ROLE_OPTIONS.map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABELS[role] || role}
                        </option>
                      ))}
                    </select>
                    {ROLE_DESCRIPTIONS[form.role_name] && (
                      <small id="staff-role-description" className="form-help-text">
                        {ROLE_DESCRIPTIONS[form.role_name]}
                      </small>
                    )}
                    <small id="staff-role-template-note" className="form-help-text staff-role-template-note">
                      Al elegir otra plantilla, se reemplazan los permisos seleccionados en este formulario. Puedes ajustarlos antes de guardar.
                    </small>
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

                <section className="staff-permission-review" aria-labelledby="staff-permission-review-title">
                  <header className="staff-permission-review-header">
                    <div>
                      <h3 id="staff-permission-review-title">Revisión de permisos</h3>
                      <p>
                        {editing
                          ? `Después de guardar tendrá ${permissionSummary.activeCount} permisos activos.`
                          : 'Estos permisos se aplicarán al crear el usuario; todavía no se han guardado.'}
                      </p>
                    </div>
                    <span
                      className={`staff-permission-review-status ${isSaving ? 'is-saving' : errorMessage ? 'has-error' : editing && permissionSummary.hasPendingChanges ? 'has-changes' : ''}`}
                      role="status"
                      aria-live="polite"
                    >
                      {isSaving
                        ? 'Guardando…'
                        : errorMessage
                          ? 'Error al guardar'
                          : editing
                            ? permissionSummary.hasPendingChanges ? 'Cambios pendientes' : 'Sin cambios'
                            : 'Sin guardar'}
                    </span>
                  </header>

                  {editing ? (
                    <>
                      <div className="staff-permission-review-changes">
                        <section aria-labelledby="staff-permissions-granted-title">
                          <h4 id="staff-permissions-granted-title">
                            Se concederán <span>{permissionSummary.granted.length}</span>
                          </h4>
                          {permissionSummary.granted.length > 0 ? (
                            <ul className="staff-permission-review-list">
                              {permissionSummary.granted.map((permission) => <li key={permission}>{permission}</li>)}
                            </ul>
                          ) : <p>No se agregan permisos.</p>}
                        </section>
                        <section aria-labelledby="staff-permissions-withdrawn-title">
                          <h4 id="staff-permissions-withdrawn-title">
                            Se retirarán <span>{permissionSummary.withdrawn.length}</span>
                          </h4>
                          {permissionSummary.withdrawn.length > 0 ? (
                            <ul className="staff-permission-review-list">
                              {permissionSummary.withdrawn.map((permission) => <li key={permission}>{permission}</li>)}
                            </ul>
                          ) : <p>No se retiran permisos.</p>}
                        </section>
                      </div>
                      <p className="staff-permission-review-unchanged">
                        Se mantienen activos sin cambios: {permissionSummary.unchangedActiveCount} permisos.
                      </p>
                    </>
                  ) : (
                    <div className="staff-permission-review-results">
                      {permissionSummary.activeByGroup.length > 0 ? permissionSummary.activeByGroup.map((group) => (
                        <section key={group.title} aria-label={group.title}>
                          <h4>{group.title}</h4>
                          <ul className="staff-permission-review-list">
                            {group.permissions.map((permission) => <li key={permission}>{permission}</li>)}
                          </ul>
                        </section>
                      )) : <p>Este usuario no recibirá permisos de acceso.</p>}
                    </div>
                  )}
                </section>

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
                            <small className="staff-permissions-count">{enabledPermissions} activos · {group.permissions.length} permisos</small>
                          </span>
                        </summary>
                        <fieldset className="staff-permissions-group">
                          <legend className="sr-only">{group.title}</legend>
                          <div className="staff-permissions-grid">
                            {group.permissions.map((permission) => {
                              const isNotificationDetail = NOTIFICATION_DETAIL_PERMISSIONS.includes(permission);
                              const isDisabled = isSaving || (
                                isNotificationDetail && form.permissions?.notifications !== true
                              ) || (
                                permission === 'pos_credit_sales' && form.permissions?.pos !== true
                              );

                              return (
                                <label
                                  key={permission}
                                  className={`staff-permission-toggle ${form.permissions?.[permission] === true ? 'is-enabled' : ''}`}
                                >
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
