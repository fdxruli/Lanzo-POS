import { normalizeMexicanPhone } from './normalizers';
import { renderCustomerMessageText } from './templates';

const NOTIFICATION_STATUSES = new Set([
  'not_requested',
  'missing_phone',
  'invalid_phone',
  'payload_invalid',
  'ready',
  'opened',
  'cancelled',
  'unsupported',
  'failed'
]);

export const notificationNotRequested = () => ({ status: 'not_requested', code: null });

export const getNotificationReadiness = (payload, { requested = true } = {}) => {
  if (!requested) return notificationNotRequested();
  if (!payload) return { status: 'payload_invalid', code: 'MESSAGE_PAYLOAD_INVALID' };

  const phone = normalizeMexicanPhone(payload.customer?.phone);
  if (phone.status === 'missing') return { status: 'missing_phone', code: phone.code };
  if (phone.status === 'invalid') return { status: 'invalid_phone', code: phone.code };

  return { status: 'ready', code: null, phone };
};

/**
 * Opens only a prepared message. This function has no dependency on a sale,
 * payment, cash, ledger, repository, or retrying financial operation.
 */
export const openCustomerNotification = async ({ payload, requested = true, openWhatsApp } = {}) => {
  const readiness = getNotificationReadiness(payload, { requested });
  if (readiness.status !== 'ready') return readiness;
  if (typeof openWhatsApp !== 'function') return { status: 'unsupported', code: 'WHATSAPP_OPENER_UNAVAILABLE' };

  const text = renderCustomerMessageText(payload);
  if (!text) return { status: 'payload_invalid', code: 'MESSAGE_PAYLOAD_INVALID' };

  try {
    const result = await openWhatsApp(readiness.phone.e164, text);
    if (result?.status) {
      if (result.status === 'ready') return { status: 'opened', code: null, phone: readiness.phone.e164 };
      if (NOTIFICATION_STATUSES.has(result.status)) return result;
      return { status: 'failed', code: 'NOTIFICATION_RESULT_INVALID' };
    }
    if (result === false || result === null) return { status: 'failed', code: 'WHATSAPP_WINDOW_BLOCKED' };
    return { status: 'opened', code: null, phone: readiness.phone.e164 };
  } catch (error) {
    return {
      status: 'failed',
      code: error?.code || 'WHATSAPP_OPEN_FAILED',
      message: error?.message || 'No se pudo abrir WhatsApp.'
    };
  }
};

export const createFinancialNotificationResult = ({ financialResult, notificationResult = notificationNotRequested() } = {}) => ({
  financialResult,
  notificationResult
});
