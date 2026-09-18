import { showMessageModal } from '../utils';
import {
  CUSTOMER_MESSAGE_OUTBOX_DEFAULTS,
  CUSTOMER_MESSAGE_OUTBOX_STATUS_LABELS,
  downloadCustomerMessageOutbox,
  shareCustomerMessageOutbox
} from './outbox';

const formatAttemptDate = (value) => {
  if (!value) return 'Sin intentos todavía';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Fecha no disponible';
  return parsed.toLocaleString('es-MX');
};

const contactNote = (record) => {
  if (record?.contactReadiness?.status === 'telefono_vacio') {
    return 'El cliente no tiene teléfono guardado. La imagen puede compartirse o descargarse manualmente.';
  }
  if (record?.contactReadiness?.status === 'telefono_invalido') {
    return 'El teléfono guardado no es válido. La imagen puede compartirse o descargarse manualmente.';
  }
  return null;
};

const statusNote = (record) => {
  switch (record?.status) {
    case 'compartido':
      return 'La hoja de compartir terminó correctamente. Lanzo no puede confirmar que WhatsApp u otra app haya entregado o recibido el archivo.';
    case 'descarga_generada':
      return record.lastErrorCode === 'WEB_SHARE_UNAVAILABLE_OR_INCOMPATIBLE'
        ? 'Este navegador no permitió compartir el archivo directamente; se generó una descarga manual.'
        : 'La imagen se descargó correctamente para que puedas adjuntarla manualmente.';
    case 'cancelado_por_usuario':
      return 'El usuario cerró o canceló la hoja de compartir. La operación financiera permanece confirmada.';
    case 'reintento_pendiente':
      return 'El último intento falló de forma recuperable. Puedes volver a intentar manualmente.';
    case 'error':
      return 'No se pudo completar la acción de mensajería. La operación financiera no fue modificada.';
    default:
      return 'La imagen está preparada. Compartirla es una acción independiente de la operación financiera.';
  }
};

export const buildCustomerMessageOutboxModalCopy = (record = {}) => {
  const status = CUSTOMER_MESSAGE_OUTBOX_STATUS_LABELS[record.status] || 'Estado no disponible';
  const lines = [
    `Estado: ${status}`,
    record.humanReference ? `Referencia: ${record.humanReference}` : null,
    `Último intento: ${formatAttemptDate(record.lastAttemptAt)}`,
    statusNote(record),
    contactNote(record)
  ].filter(Boolean);

  if (record.lastErrorCode) lines.push(`Código: ${record.lastErrorCode}`);
  return lines.join('\n\n');
};

const canRetryShare = (record) => Number(record?.shareAttemptCount || 0) < Number(
  record?.retryPolicy?.maxAttempts || CUSTOMER_MESSAGE_OUTBOX_DEFAULTS.maxAttempts
);

export const showCustomerMessageOutboxModal = (record, {
  title = 'Mensaje al cliente',
  onStateChange = null,
  shareAction = shareCustomerMessageOutbox,
  downloadAction = downloadCustomerMessageOutbox
} = {}) => {
  if (!record) {
    showMessageModal(
      'No se pudo abrir el registro del mensaje. La operación financiera permanece confirmada.',
      null,
      { type: 'warning' }
    );
    return;
  }

  const retryable = canRetryShare(record);
  const primaryText = record.status === 'preparado'
    ? 'Compartir imagen'
    : (retryable ? 'Volver a intentar' : 'Cerrar');

  const runShare = retryable
    ? async () => {
      const result = await shareAction({ record });
      const next = result?.record || record;
      onStateChange?.(next, result);
      showCustomerMessageOutboxModal(next, { title, onStateChange, shareAction, downloadAction });
      return result;
    }
    : null;

  const runDownload = async () => {
    const result = await downloadAction({ record });
    const next = result?.record || record;
    onStateChange?.(next, result);
    showCustomerMessageOutboxModal(next, { title, onStateChange, shareAction, downloadAction });
    return result;
  };

  if (!runShare) {
    showMessageModal(buildCustomerMessageOutboxModalCopy(record), null, {
      title,
      type: record.status === 'error' ? 'warning' : 'info',
      extraButton: {
        text: 'Descargar imagen',
        action: runDownload
      }
    });
    return;
  }

  showMessageModal(
    buildCustomerMessageOutboxModalCopy(record),
    runShare,
    {
      title,
      confirmButtonText: primaryText,
      cancelButtonText: 'Ahora no',
      showCancel: true,
      type: ['error', 'reintento_pendiente'].includes(record.status) ? 'warning' : 'info',
      extraButton: {
        text: 'Descargar imagen',
        action: runDownload
      }
    }
  );
};
