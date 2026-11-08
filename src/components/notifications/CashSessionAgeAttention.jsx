import { useId } from 'react';
import { AlertTriangle, Clock3 } from 'lucide-react';

const getTitle = (count) => (
  'Tienes ' + count + ' caja' + (count === 1 ? '' : 's')
  + ' abierta' + (count === 1 ? '' : 's')
  + ' que requiere' + (count === 1 ? '' : 'n') + ' revisión'
);

export default function CashSessionAgeAttention({
  attention,
  onReview,
  className = ''
}) {
  const titleId = useId();
  const count = Number(attention?.pendingCount || 0);
  const reviewCount = Number(attention?.reviewCount || 0);
  const isUnavailable = attention?.status === 'unavailable';

  if (!attention || (!isUnavailable && !(attention.status === 'success' && count > 0))) {
    return null;
  }

  return (
    <section
      className={['cash-session-age-attention', className].filter(Boolean).join(' ')}
      aria-labelledby={titleId}
      role="status"
      data-priority={reviewCount > 0 ? 'review' : 'important'}
    >
      <div className="cash-session-age-attention__heading">
        <span className="cash-session-age-attention__icon" aria-hidden="true">
          {isUnavailable ? <Clock3 size={18} /> : <AlertTriangle size={18} />}
        </span>
        <div>
          <p className="cash-session-age-attention__eyebrow">Atención de Caja</p>
          <h3 id={titleId}>
            {isUnavailable ? 'Consulta de cajas no disponible' : getTitle(count)}
          </h3>
        </div>
      </div>

      {isUnavailable ? (
        <p>No se pudo confirmar el estado de las cajas. Vuelve a consultar cuando Caja esté disponible.</p>
      ) : (
        <>
          <p>
            {reviewCount > 0
              ? reviewCount + (reviewCount === 1
                ? ' caja lleva 3 días o más abierta y requiere atención prioritaria.'
                : ' cajas llevan 3 días o más abiertas y requieren atención prioritaria.')
              : 'Puedes abrir Caja para revisar las sesiones afectadas.'}
          </p>
          <div className="cash-session-age-attention__actions">
            <button
              type="button"
              className="ui-button ui-button--secondary"
              onClick={onReview}
              disabled={!onReview}
            >
              Revisar cajas
            </button>
          </div>
        </>
      )}
    </section>
  );
}
