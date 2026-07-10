import { LoaderCircle, RefreshCw, SearchX, Store } from 'lucide-react';

const ICONS = {
  loading: LoaderCircle,
  unavailable: Store,
  error: RefreshCw,
  empty: Store,
  noResults: SearchX,
};

function PublicStoreState({ type = 'empty', title, description, actionLabel, onAction, compact = false }) {
  const Icon = ICONS[type] || Store;

  return (
    <section
      className={`public-store-state${compact ? ' public-store-state--compact' : ''}`}
      role={type === 'error' || type === 'unavailable' ? 'alert' : 'status'}
      aria-live="polite"
    >
      <Icon
        aria-hidden="true"
        size={compact ? 28 : 38}
        className={type === 'loading' ? 'public-store-state__spinner' : undefined}
      />
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {actionLabel && onAction ? (
        <button type="button" className="ui-button ui-button--secondary" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </section>
  );
}

export default PublicStoreState;
