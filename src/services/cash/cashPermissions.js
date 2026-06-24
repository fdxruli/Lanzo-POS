import { useAppStore } from '../../store/useAppStore';

export const CASH_PERMISSION = 'cash_register';
export const CASH_AUDIT_PERMISSIONS = ['reports', 'cash_audit', 'caja_auditoria'];

export const canUseCashRegister = () => {
  const state = useAppStore.getState();
  if (state?.currentDeviceRole !== 'staff') return true;
  return Boolean(
    state?.currentStaffUser?.permissions?.[CASH_PERMISSION] === true ||
    state?.currentStaffUser?.permissions?.caja === true
  );
};

export const canAuditCashSessions = () => {
  const state = useAppStore.getState();
  if (state?.currentDeviceRole !== 'staff') return true;
  return CASH_AUDIT_PERMISSIONS.some((permission) => state?.currentStaffUser?.permissions?.[permission] === true);
};

export const assertCanUseCashRegister = () => {
  if (!canUseCashRegister()) {
    throw new Error('No tienes permiso para operar caja. Pide al administrador que active el permiso Caja.');
  }
};
