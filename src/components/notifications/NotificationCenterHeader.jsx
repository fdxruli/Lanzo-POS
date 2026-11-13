import { BellRing, RefreshCw, SlidersHorizontal, X } from 'lucide-react';

export default function NotificationCenterHeader({
  onClose,
  onRefresh,
  onTogglePreferences,
  refreshDisabled = false,
  refreshing = false,
  showPreferences = false
}) {
  return (
    <header className="notification-center-header">
      <div className="notification-center-header__copy">
        <p className="notification-center-eyebrow">
          <BellRing size={13} aria-hidden="true" />
          LANZO NUBE
        </p>
        <h2 id="notification-center-title">Notificaciones</h2>
      </div>

      <div className="notification-center-header__actions">
        {onRefresh && onTogglePreferences && (
          <>
            <button
              type="button"
              className={`notification-center-header__action ${refreshing ? 'is-refreshing' : ''}`}
              onClick={onRefresh}
              disabled={refreshDisabled}
              aria-label={refreshing ? 'Actualizando' : 'Actualizar'}
              title={refreshing ? 'Actualizando notificaciones' : 'Actualizar notificaciones'}
            >
              <RefreshCw size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`notification-center-header__action ${showPreferences ? 'is-active' : ''}`}
              onClick={onTogglePreferences}
              aria-label={showPreferences ? 'Cerrar preferencias' : 'Preferencias'}
              aria-expanded={showPreferences}
              aria-controls={showPreferences ? 'notification-center-preferences' : undefined}
              title={showPreferences ? 'Cerrar preferencias' : 'Preferencias'}
            >
              <SlidersHorizontal size={18} aria-hidden="true" />
            </button>
          </>
        )}
        <button
          type="button"
          className="notification-center-close"
          onClick={onClose}
          aria-label="Cerrar centro de notificaciones"
          title="Cerrar"
        >
          <X size={20} strokeWidth={2.5} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
