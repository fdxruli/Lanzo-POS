import { Inbox } from 'lucide-react';

const TAB_LABELS = {
  all: 'todas',
  unread: 'no leídas',
  operation: 'operación',
  system: 'sistema',
  support: 'soporte',
  license: 'licencia'
};

export default function NotificationEmptyState({ activeTab = 'all' }) {
  const tabLabel = TAB_LABELS[activeTab] || TAB_LABELS.all;

  return (
    <section className="notification-empty-state" aria-live="polite">
      <div className="notification-empty-state__icon" aria-hidden="true">
        <Inbox size={28} />
      </div>
      <h3>{activeTab === 'all' ? 'No tienes notificaciones por ahora.' : 'No hay notificaciones en esta categoría.'}</h3>
      {activeTab === 'all' && (
        <p>
          Cuando haya avisos de soporte, licencia u operación cloud aparecerán aquí.
        </p>
      )}
      <span>Vista: {tabLabel}</span>
    </section>
  );
}
