import { useId, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import {
  dismissAsyncIncidentNotice,
  getAsyncIncidentNotices,
  subscribeAsyncIncidentNotices
} from '../../services/diagnostics/incidentEventCenter';
import IncidentReportEntry from './IncidentReportEntry';
import './AdminIncidentNotice.css';

const useIncidentNotices = () => useSyncExternalStore(
  subscribeAsyncIncidentNotices,
  getAsyncIncidentNotices,
  getAsyncIncidentNotices
);

const getNoticeCopy = (notice) => {
  if (notice.critical && notice.metadata.category === 'financial_operation') {
    return {
      title: 'Necesitamos verificar una operación',
      message: 'No pudimos confirmar su resultado. Revisa el recibo antes de volver a intentarla.'
    };
  }

  const messages = {
    indexeddb: {
      title: 'El almacenamiento local requiere revisión',
      message: 'No borres los datos del navegador. Abre el diagnóstico local para revisar el estado.'
    },
    authorization_session: {
      title: 'La sesión necesita revisión',
      message: 'Vuelve a abrir la sección desde tu sesión actual antes de reintentar una acción.'
    },
    synchronization: {
      title: 'La sincronización tuvo un problema',
      message: 'No pudimos confirmar la sincronización en este momento. Revisa su estado al recuperar conexión.'
    },
    connectivity: {
      title: 'La conexión tuvo una interrupción',
      message: 'Algunas funciones remotas pueden tardar en responder. La operación local disponible se conserva.'
    },
    supabase_rpc: {
      title: 'Un servicio remoto no respondió',
      message: 'No se confirmó la respuesta del servicio. Revisa el estado antes de volver a intentar una operación.'
    },
    navigation_resource: {
      title: 'Una sección no pudo cargar un recurso',
      message: 'Puedes conservar el resto de Lanzo y volver a abrir esa sección.'
    },
    pwa: {
      title: 'La aplicación instalada necesita revisión',
      message: 'La versión instalada sigue disponible. Revisa la actualización antes de volver a intentar.'
    }
  };

  return messages[notice.metadata.category] || null;
};

export default function AdminIncidentNotice() {
  const notices = useIncidentNotices();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId().replace(/:/g, '');
  const notice = notices[0];
  if (!notice) return null;

  const copy = getNoticeCopy(notice);
  if (!copy) return null;

  const isCritical = notice.critical;
  const role = isCritical ? 'alert' : 'status';

  return (
    <aside
      className={'admin-incident-notice' + (isCritical ? ' admin-incident-notice--critical' : '')}
      role={role}
      aria-live={isCritical ? 'assertive' : 'polite'}
      aria-labelledby={'admin-incident-title-' + detailsId}
    >
      <span className="admin-incident-notice__icon" aria-hidden="true">
        <AlertTriangle size={18} />
      </span>
      <div className="admin-incident-notice__body">
        <h2 id={'admin-incident-title-' + detailsId}>{copy.title}</h2>
        <p>{copy.message}</p>
        <button
          type="button"
          className="admin-incident-notice__details-toggle"
          aria-expanded={detailsOpen}
          aria-controls={'admin-incident-details-' + detailsId}
          onClick={() => setDetailsOpen((open) => !open)}
        >
          {detailsOpen ? 'Ocultar detalles' : 'Detalles del problema'}
        </button>
        <div id={'admin-incident-details-' + detailsId} hidden={!detailsOpen}>
          <dl>
            <div><dt>Código</dt><dd>{notice.metadata.code}</dd></div>
            <div><dt>Tipo</dt><dd>{notice.metadata.categoryLabel}</dd></div>
            <div><dt>Sección</dt><dd>{notice.metadata.section}</dd></div>
            <div><dt>Fecha y hora</dt><dd>{new Date(notice.metadata.timestamp).toLocaleString('es-MX')}</dd></div>
          </dl>
          <IncidentReportEntry
            incident={notice.incident}
            isContextCurrent={notice.isContextCurrent}
          />
        </div>
      </div>
      <button
        type="button"
        className="admin-incident-notice__dismiss"
        onClick={() => dismissAsyncIncidentNotice(notice.correlationId)}
        aria-label="Cerrar aviso de incidencia"
      >
        <X size={18} aria-hidden="true" />
      </button>
    </aside>
  );
}
