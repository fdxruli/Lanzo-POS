import { useAppStore } from '../../store/useAppStore';
import {
  customerMessageCloudRepository,
  getCustomerMessagingLicenseEligibility,
  getCustomerMessagingPlanRequirement
} from './cloudRepository';

export const CUSTOMER_MESSAGE_REMINDER_STATUSES = Object.freeze([
  'programado',
  'listo_para_preparar',
  'preparado',
  'cancelado',
  'reintento_pendiente',
  'error'
]);

export const CUSTOMER_MESSAGE_REMINDER_STATUS_LABELS = Object.freeze({
  programado: 'Programado',
  listo_para_preparar: 'Listo para preparar',
  preparado: 'Preparado',
  cancelado: 'Cancelado',
  reintento_pendiente: 'Reintento pendiente',
  error: 'Error'
});

export const CUSTOMER_MESSAGE_REMINDER_DEFAULTS = Object.freeze({
  enabled: false,
  timeZone: 'America/Mexico_City',
  localTime: '10:00',
  maxAttempts: 3,
  backoffMinutes: 30
});

export const CUSTOMER_MESSAGE_REMINDER_ERROR_COPY = Object.freeze({
  CUSTOMER_MESSAGE_CLOUD_UNAVAILABLE: 'Los recordatorios cloud requieren Lanzo Nube.',
  LICENSE_EXPIRED: 'Los recordatorios cloud requieren una licencia Pro/Nube vigente.',
  LICENSE_NOT_ACTIVE: 'Los recordatorios cloud requieren una licencia Pro/Nube vigente.',
  LICENSE_NOT_ENTITLED: 'Los recordatorios cloud requieren una licencia Pro/Nube vigente.',
  LICENSE_LIFECYCLE_STALE: 'Los recordatorios cloud requieren una licencia Pro/Nube vigente.',
  CUSTOMER_MESSAGE_ADMIN_REQUIRED: 'Solo un Admin puede modificar los recordatorios.',
  CUSTOMER_MESSAGE_STAFF_NOT_ALLOWED: 'Staff puede consultar el estado, pero no modificar recordatorios.',
  CUSTOMER_MESSAGE_AUTH_CONTEXT_MISSING: 'No se pudo validar la sesión cloud actual.',
  SUPABASE_UNAVAILABLE: 'La sincronización cloud no está disponible en este dispositivo.',
  REMINDER_CONFIG_DISABLED: 'Activa los recordatorios antes de programar una cuenta.',
  REMINDER_CUSTOMER_NOT_PENDING: 'La cuenta ya no tiene saldo pendiente; no se programó el recordatorio.',
  REMINDER_CUSTOMER_NOT_FOUND: 'No se encontró la cuenta del cliente.',
  REMINDER_NOT_FOUND: 'No se encontró el recordatorio.',
  REMINDER_TIMEZONE_INVALID: 'La zona horaria no es válida.',
  REMINDER_DATE_INVALID: 'La fecha del recordatorio debe ser futura.',
  REMINDER_CONFLICT: 'Otro dispositivo actualizó este recordatorio. Recarga la lista.',
  REMINDER_SCHEDULE_FAILED: 'No se pudo programar el recordatorio. Intenta de nuevo.',
  REMINDER_CANCEL_FAILED: 'No se pudo cancelar el recordatorio. Intenta de nuevo.',
  REMINDER_RESCHEDULE_FAILED: 'No se pudo reprogramar el recordatorio. Intenta de nuevo.',
  REMINDER_LIST_FAILED: 'No se pudo cargar el historial de recordatorios.',
  CUSTOMER_MESSAGE_RPC_FAILED: 'No se pudo actualizar el recordatorio. Intenta de nuevo.'
});

export const getCustomerMessageReminderErrorCopy = (code) => (
  CUSTOMER_MESSAGE_REMINDER_ERROR_COPY[code] || 'No se pudo actualizar el recordatorio. Intenta de nuevo.'
);

const currentLicenseDetails = () => useAppStore.getState().licenseDetails;

const isStaffActor = (actorType, licenseDetails) => (
  actorType === 'staff' || licenseDetails?.device_role === 'staff'
);

const validateCloudMutationAccess = (licenseDetails, options) => {
  const eligibility = getCustomerMessagingLicenseEligibility(licenseDetails);
  if (!eligibility.ok) return eligibility;
  if (isStaffActor(options.actorType, licenseDetails)) {
    return { ok: false, code: 'CUSTOMER_MESSAGE_STAFF_NOT_ALLOWED' };
  }
  return { ok: true };
};

export const listCustomerMessageReminders = async ({ repository = customerMessageCloudRepository, ...options } = {}) => {
  const licenseDetails = options.licenseDetails || currentLicenseDetails();
  const eligibility = getCustomerMessagingLicenseEligibility(licenseDetails);
  if (!eligibility.ok) {
    return { ...eligibility, planRequired: getCustomerMessagingPlanRequirement(), reminders: [], config: null };
  }
  return repository.listReminders({ ...options, licenseDetails });
};

export const saveCustomerMessageReminderConfig = async ({ repository = customerMessageCloudRepository, ...options } = {}) => {
  const licenseDetails = options.licenseDetails || currentLicenseDetails();
  const access = validateCloudMutationAccess(licenseDetails, options);
  if (!access.ok) {
    return { ...access, planRequired: getCustomerMessagingPlanRequirement() };
  }
  return repository.saveReminderConfig({ ...options, licenseDetails });
};

export const scheduleCustomerMessageReminder = async (customerId, { repository = customerMessageCloudRepository, ...options } = {}) => {
  const licenseDetails = options.licenseDetails || currentLicenseDetails();
  const access = validateCloudMutationAccess(licenseDetails, options);
  if (!access.ok) {
    return { ...access, planRequired: getCustomerMessagingPlanRequirement() };
  }
  return repository.scheduleReminder(customerId, { ...options, licenseDetails });
};

export const cancelCustomerMessageReminder = async (reminderId, { repository = customerMessageCloudRepository, ...options } = {}) => {
  const licenseDetails = options.licenseDetails || currentLicenseDetails();
  const access = validateCloudMutationAccess(licenseDetails, options);
  if (!access.ok) {
    return { ...access, planRequired: getCustomerMessagingPlanRequirement() };
  }
  return repository.cancelReminder(reminderId, { ...options, licenseDetails });
};

export const rescheduleCustomerMessageReminder = async (reminderId, scheduledFor, { repository = customerMessageCloudRepository, ...options } = {}) => {
  const licenseDetails = options.licenseDetails || currentLicenseDetails();
  const access = validateCloudMutationAccess(licenseDetails, options);
  if (!access.ok) {
    return { ...access, planRequired: getCustomerMessagingPlanRequirement() };
  }
  return repository.rescheduleReminder(reminderId, scheduledFor, { ...options, licenseDetails });
};
