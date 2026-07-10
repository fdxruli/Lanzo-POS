import { LifeBuoy } from 'lucide-react';

export default function NotificationSupportEntry({
  supportChannel = 'in_app',
  onOpenSupport
}) {
  const isInApp = supportChannel === 'in_app';

  return (
    <section className="notification-support-entry" aria-labelledby="notification-support-title">
      <div className="notification-support-entry__icon" aria-hidden="true">
        <LifeBuoy size={20} />
      </div>
      <div className="notification-support-entry__copy">
        <p className="notification-support-entry__eyebrow">
          {isInApp ? 'Soporte interno' : 'Soporte por correo'}
        </p>
        <h3 id="notification-support-title">Soporte Lanzo Nube</h3>
        <p>Crea y consulta solicitudes desde el sistema.</p>
        <button
          type="button"
          className="notification-support-entry__button"
          onClick={onOpenSupport}
          disabled={!isInApp || !onOpenSupport}
        >
          Abrir soporte
        </button>
        <small>Las respuestas aparecerán en el Centro de Notificaciones.</small>
      </div>
    </section>
  );
}
