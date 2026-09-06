export const SALES_REPORTS_PERMISSION = 'reports';
export const SALES_REFUNDS_PERMISSION = 'refunds';
export const SALES_REPORTS_AUDIT_PERMISSIONS = Object.freeze([
  'reportes_globales',
  'reports_global',
  'caja_auditoria',
  'cash_audit'
]);

const hasIdentity = (value) => (
  (typeof value === 'string' && value.trim().length > 0)
  || (typeof value === 'number' && Number.isFinite(value))
);

const resolveAuthority = (authority = {}) => {
  if (Object.prototype.hasOwnProperty.call(authority, 'currentDeviceRole')) {
    if (authority.currentDeviceRole === 'admin' && hasIdentity(authority.currentAdminUser?.id)) {
      return { actorType: 'admin', permissions: ['*'] };
    }
    if (authority.currentDeviceRole === 'staff' && hasIdentity(authority.currentStaffUser?.id)) {
      return { actorType: 'staff', permissions: authority.currentStaffUser?.permissions || null };
    }
    return { actorType: null, permissions: null };
  }

  if (
    authority.status === 'granted'
    && hasIdentity(authority.actorId)
    && hasIdentity(authority.sessionId)
    && ['admin', 'staff'].includes(authority.actorType)
  ) {
    return { actorType: authority.actorType, permissions: authority.permissions || null };
  }

  return { actorType: null, permissions: null };
};

export const getSalesActorIdentity = (authority = {}) => {
  if (Object.prototype.hasOwnProperty.call(authority, 'currentDeviceRole')) {
    const actor = authority.currentDeviceRole === 'admin'
      ? authority.currentAdminUser
      : authority.currentDeviceRole === 'staff'
        ? authority.currentStaffUser
        : null;
    return hasIdentity(actor?.id) ? `${authority.currentDeviceRole}:${String(actor.id).trim()}` : null;
  }

  return authority.status === 'granted'
    && ['admin', 'staff'].includes(authority.actorType)
    && hasIdentity(authority.actorId)
    && hasIdentity(authority.sessionId)
    ? `${authority.actorType}:${String(authority.actorId).trim()}:${String(authority.sessionId).trim()}`
    : null;
};

const hasExplicitPermission = (permissions, permission) => {
  if (Array.isArray(permissions)) return permissions.includes(permission);
  return permissions?.[permission] === true;
};

export const hasSalesActorPermission = (authority = {}, permission) => {
  const { actorType, permissions } = resolveAuthority(authority);
  if (actorType === 'admin') return true;
  if (actorType !== 'staff') return false;
  return hasExplicitPermission(permissions, permission);
};

export const canReadSalesReports = (authority = {}) => (
  hasSalesActorPermission(authority, SALES_REPORTS_PERMISSION)
);

/**
 * This mirrors the *client hint* accepted by the reports RPC. The server still
 * decides whether `scope: license` is authorized from its verified actor
 * context; this merely avoids requesting a wider scope for ordinary staff.
 */
export const canAuditSalesReports = (authority = {}) => {
  const { actorType, permissions } = resolveAuthority(authority);
  if (actorType === 'admin') return true;
  if (actorType !== 'staff') return false;
  return SALES_REPORTS_AUDIT_PERMISSIONS.some((permission) => (
    hasExplicitPermission(permissions, permission)
  ));
};

export const getSalesFinalHistoryScope = (authority = {}) => (
  canAuditSalesReports(authority) ? 'license' : 'mine'
);

export const canPerformRefunds = (authority = {}) => (
  hasSalesActorPermission(authority, SALES_REFUNDS_PERMISSION)
);

export default Object.freeze({
  canReadSalesReports,
  canAuditSalesReports,
  getSalesFinalHistoryScope,
  canPerformRefunds,
  hasSalesActorPermission,
  getSalesActorIdentity
});
