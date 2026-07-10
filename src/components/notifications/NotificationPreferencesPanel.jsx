import { RotateCcw, SlidersHorizontal, VolumeX } from 'lucide-react';
import {
  NOTIFICATION_CATEGORIES,
  isCategoryMuted,
  normalizeNotificationPreferences
} from '../../services/notifications/notificationPreferencesService';

const CATEGORY_LABELS = {
  support: 'Soporte',
  cash: 'Caja',
  sync: 'Sincronización',
  license: 'Licencia',
  system: 'Sistema'
};

const MUTE_OPTIONS = [
  { label: '1 hora', durationMs: 60 * 60 * 1000 },
  { label: '24 horas', durationMs: 24 * 60 * 60 * 1000 },
  { label: '7 días', durationMs: 7 * 24 * 60 * 60 * 1000 }
];

const formatMutedUntil = (value) => {
  if (!value) return '';

  try {
    return new Intl.DateTimeFormat('es-MX', {
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(new Date(value));
  } catch {
    return '';
  }
};

export default function NotificationPreferencesPanel({
  preferences,
  onUpdate,
  onMuteCategory,
  onUnmuteCategory,
  onReset
}) {
  const normalized = normalizeNotificationPreferences(preferences);

  const toggleBoolean = (key) => {
    onUpdate?.({ [key]: !normalized[key] });
  };

  const toggleCategoryMap = (mapKey, category) => {
    onUpdate?.({
      [mapKey]: {
        ...normalized[mapKey],
        [category]: normalized[mapKey]?.[category] === false
      }
    });
  };

  return (
    <section className="notification-preferences" aria-label="Preferencias de notificaciones">
      <header className="notification-preferences__header">
        <span className="notification-preferences__icon" aria-hidden="true">
          <SlidersHorizontal size={16} />
        </span>
        <div>
          <h3>Preferencias</h3>
          <p>Estos ajustes solo aplican en este dispositivo.</p>
        </div>
      </header>

      <div className="notification-preferences__switches">
        <label className="notification-preference-toggle">
          <input
            type="checkbox"
            checked={normalized.compactMode}
            onChange={() => toggleBoolean('compactMode')}
          />
          <span>Modo compacto</span>
        </label>
        <label className="notification-preference-toggle">
          <input
            type="checkbox"
            checked={normalized.showInfoNotifications}
            onChange={() => toggleBoolean('showInfoNotifications')}
          />
          <span>Mostrar notificaciones informativas</span>
        </label>
      </div>

      <div className="notification-preferences__section">
        <h4>Mostrar en ticker</h4>
        <div className="notification-preferences__grid">
          {NOTIFICATION_CATEGORIES.map((category) => (
            <label key={`ticker-${category}`} className="notification-preference-toggle">
              <input
                type="checkbox"
                checked={normalized.tickerCategories?.[category] !== false}
                onChange={() => toggleCategoryMap('tickerCategories', category)}
              />
              <span>{CATEGORY_LABELS[category]}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="notification-preferences__section">
        <h4>Destacar en centro</h4>
        <div className="notification-preferences__grid">
          {NOTIFICATION_CATEGORIES.map((category) => (
            <label key={`featured-${category}`} className="notification-preference-toggle">
              <input
                type="checkbox"
                checked={normalized.featuredCategories?.[category] !== false}
                onChange={() => toggleCategoryMap('featuredCategories', category)}
              />
              <span>{CATEGORY_LABELS[category]}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="notification-preferences__section">
        <h4>Silenciar categoría</h4>
        <div className="notification-preferences__mute-list">
          {NOTIFICATION_CATEGORIES.map((category) => {
            const muted = isCategoryMuted(category, normalized);
            const mutedUntil = formatMutedUntil(normalized.mutedCategories?.[category]);

            return (
              <div key={`mute-${category}`} className="notification-preference-mute-row">
                <div>
                  <strong>{CATEGORY_LABELS[category]}</strong>
                  {muted && <small>Silenciado hasta {mutedUntil}</small>}
                </div>
                <div className="notification-preference-mute-row__actions">
                  {MUTE_OPTIONS.map((option) => (
                    <button
                      key={`${category}-${option.label}`}
                      type="button"
                      onClick={() => onMuteCategory?.(category, option.durationMs)}
                    >
                      {option.label}
                    </button>
                  ))}
                  {muted && (
                    <button
                      type="button"
                      className="notification-preference-mute-row__clear"
                      onClick={() => onUnmuteCategory?.(category)}
                    >
                      Quitar
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        className="notification-preferences__reset"
        onClick={onReset}
      >
        <RotateCcw size={14} aria-hidden="true" />
        Restablecer preferencias
      </button>

      <p className="notification-preferences__note">
        <VolumeX size={14} aria-hidden="true" />
        Las alertas críticas y soporte siguen visibles en el centro aunque una categoría esté silenciada.
      </p>
    </section>
  );
}
