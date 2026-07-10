import { BellRing, X } from 'lucide-react';

export default function NotificationCenterHeader({
  onClose
}) {
  return (
    <header className="notification-center-header">
      <div className="notification-center-header__icon" aria-hidden="true">
        <BellRing size={22} />
      </div>

      <div className="notification-center-header__copy">
        <p className="notification-center-eyebrow">Lanzo Nube</p>
        <h2 id="notification-center-title">Centro de notificaciones</h2>
      </div>

      <button
        type="button"
        className="notification-center-close"
        onClick={onClose}
        aria-label="Cerrar centro de notificaciones"
      >
        <X size={20} strokeWidth={2.5} />
      </button>
    </header>
  );
}
