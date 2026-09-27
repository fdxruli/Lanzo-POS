import { LoaderCircle, RefreshCw, SearchX, Store } from 'lucide-react';

const ICONS = {
  loading: LoaderCircle,
  unavailable: Store,
  invalid: SearchX,
  notFound: SearchX,
  paused: Store,
  error: RefreshCw,
  empty: Store,
  noResults: SearchX,
};

function PublicStoreState({
  type = 'empty',
  title,
  description,
  actionLabel,
  actionHref,
  actionVariant = 'button',
  onAction,
  compact = false,
}) {
  const Icon = ICONS[type] || Store;
  const actionClassName = actionVariant === 'link'
    ? 'public-store-state__action public-store-state__action--link'
    : 'ui-button ui-button--secondary public-store-state__action';

  return (
    <section
      className={`public-store-state${compact ? ' public-store-state--compact' : ''}`}
      role={['error', 'unavailable', 'invalid', 'notFound', 'paused'].includes(type) ? 'alert' : 'status'}
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
      {actionLabel && actionHref ? (
        <a className={actionClassName} href={actionHref} target="_blank" rel="noopener noreferrer">
          {actionLabel}
        </a>
      ) : actionLabel && onAction ? (
        <button type="button" className={actionClassName} onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </section>
  );
}

export default PublicStoreState;
