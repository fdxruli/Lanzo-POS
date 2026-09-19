import { useAppStore } from '../../store/useAppStore';
import {
  customerMessageCloudRepository,
  getCustomerMessagingPlanRequirement,
  isCloudCustomerMessagingEnabled
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
  REMINDER_CONFIG_DISABLED: 'Activa los recordatorios antes de programar una cuenta.',
  REMINDER_CUSTOMER_NOT_PENDING: 'La cuenta ya no tiene saldo pendiente; no se programó el recordatorio.',
  REMINDER_CUSTOMER_NOT_FOUND: 'No se encontró la cuenta del cliente.',
  REMINDER_TIMEZONE_INVALID: 'La zona horaria no es válida.',
  REMINDER_DATE_INVALID: 'La fecha del recordatorio debe ser futura.',
  REMINDER_CONFLICT: 'Otro dispositivo actualizó este recordatorio. Recarga la lista.',
  SUPABASE_UNAVAILABLE: 'La sincronización cloud no está disponible en este dispositivo.'
});

export const getCustomerMessageReminderErrorCopy = (code) => (
  CUSTOMER_MESSAGE_REMINDER_ERROR_COPY[code] || 'No se pudo actualizar el recordatorio. Intenta de nuevo.'
);

const currentLicenseDetails = () => useAppStore.getState().licenseDetails;

export const listCustomerMessageReminders = async ({ repository = customerMessageCloudRepository, ...options } = {}) => {
  const licenseDetails = options.licenseDetails || currentLicenseDetails();
  if (!isCloudCustomerMessagingEnabled(licenseDetails)) {
    return { ok: false, code: 'CUSTOMER_MESSAGE_CLOUD_UNAVAILABLE', planRequired: getCustomerMessagingPlanRequirement(), reminders: [], config: null };
  }
  return repository.listReminders({ ...options, licenseDetails });
};

export const saveCustomerMessageReminderConfig = async ({ repository = customerMessageCloudRepository, ...options } = {}) => {
  const licenseDetails = options.licenseDetails || currentLicenseDetails();
  if (!isCloudCustomerMessagingEnabled(licenseDetails)) {
    return { ok: false, code: 'CUSTOMER_MESSAGE_CLOUD_UNAVAILABLE', planRequired: getCustomerMessagingPlanRequirement() };
  }
  return repository.saveReminderConfig({ ...options, licenseDetails });
};

export const scheduleCustomerMessageReminder = async (customerId, { repository = customerMessageCloudRepository, ...options } = {}) => {
  const licenseDetails = options.licenseDetails || currentLicenseDetails();
  if (!isCloudCustomerMessagingEnabled(licenseDetails)) {
    return { ok: false, code: 'CUSTOMER_MESSAGE_CLOUD_UNAVAILABLE', planRequired: getCustomerMessagingPlanRequirement() };
  }
  return repository.scheduleReminder(customerId, { ...options, licenseDetails });
};

export const cancelCustomerMessageReminder = async (reminderId, { repository = customerMessageCloudRepository, ...options } = {}) => {
  const licenseDetails = options.licenseDetails || currentLicenseDetails();
  if (!isCloudCustomerMessagingEnabled(licenseDetails)) {
    return { ok: false, code: 'CUSTOMER_MESSAGE_CLOUD_UNAVAILABLE', planRequired: getCustomerMessagingPlanRequirement() };
  }
  return repository.cancelReminder(reminderId, { ...options, licenseDetails });
};

export const rescheduleCustomerMessageReminder = async (reminderId, scheduledFor, { repository = customerMessageCloudRepository, ...options } = {}) => {
  const licenseDetails = options.licenseDetails || currentLicenseDetails();
  if (!isCloudCustomerMessagingEnabled(licenseDetails)) {
    return { ok: false, code: 'CUSTOMER_MESSAGE_CLOUD_UNAVAILABLE', planRequired: getCustomerMessagingPlanRequirement() };
  }
  return repository.rescheduleReminder(reminderId, scheduledFor, { ...options, licenseDetails });
};
