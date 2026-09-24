import { useState } from 'react';
import { CheckCircle2, CloudOff, RefreshCw, Store, WalletCards } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import usePostDowngradeCashPending, {
  consumeFreeDeviceTakeoverCompleted
} from '../../hooks/usePostDowngradeCashPending';

export default function PostDowngradeRecoveryBanner() {
  const navigate = useNavigate();
  const {
    eligible,
    online,
    status,
    pendingCount,
    isPostDowngrade,
    error,
    refresh
  } = usePostDowngradeCashPending();
  const [takeoverCompleted] = useState(() => consumeFreeDeviceTakeoverCompleted());
  const [dismissed, setDismissed] = useState(false);

  if (!eligible || dismissed) return null;

  const hasKnownPending = Number.isInteger(pendingCount) && pendingCount > 0;
  const hasKnownZero = pendingCount === 0;
  const knownTransition = isPostDowngrade || takeoverCompleted;

  if (!knownTransition && !hasKnownPending) return null;
  if (hasKnownZero && !takeoverCompleted) return null;

  const needsConnection = !online || status === 'offline_known';
  const verificationProblem = ['error', 'unknown'].includes(status);
  const title = takeoverCompleted
    ? 'Este dispositivo ya está activo'
    : 'Tu negocio ahora usa Lanzo Local';

  return (
    <section
      className="post-downgrade-banner"
      role="status"
      aria-live="polite"
      aria-busy={status === 'loading'}
      aria-label="Recuperación después del cambio a Lanzo Local"
    >
      <div className="post-downgrade-banner__icon" aria-hidden="true">
        {needsConnection ? <CloudOff size={22} /> : takeoverCompleted ? <CheckCircle2 size={22} /> : <Store size={22} />}
      </div>

      <div className="post-downgrade-banner__content">
        <strong>{title}</strong>

        {takeoverCompleted && (
          <p>Lanzo Local está listo en este dispositivo. Tus datos del negocio permanecen intactos.</p>
        )}

        {hasKnownPending && (
          <p>
            Tienes {pendingCount} caja{pendingCount === 1 ? '' : 's'} del plan anterior pendiente{pendingCount === 1 ? '' : 's'} de revisar.
          </p>
        )}

        {needsConnection && hasKnownPending && (
          <p className="post-downgrade-banner__hint">
            Conéctate a internet para revisar las cajas pendientes.
          </p>
        )}

        {verificationProblem && isPostDowngrade && (
          <p className="post-downgrade-banner__hint">
            {error || 'No pudimos verificar si siguen existiendo cajas pendientes del plan anterior.'}
          </p>
        )}

        {status === 'loading' && takeoverCompleted && (
          <p className="post-downgrade-banner__hint">Revisando si quedaron operaciones del plan anterior…</p>
        )}
      </div>

      <div className="post-downgrade-banner__actions">
        {hasKnownPending && (
          <button
            type="button"
            className="ui-button ui-button--secondary"
            onClick={() => navigate('/caja')}
            disabled={!online}
          >
            <WalletCards size={17} aria-hidden="true" />
            Revisar cajas pendientes
          </button>
        )}

        {verificationProblem && isPostDowngrade && online && (
          <button
            type="button"
            className="ui-button ui-button--secondary"
            onClick={() => refresh()}
          >
            <RefreshCw size={17} aria-hidden="true" />
            Reintentar
          </button>
        )}

        {hasKnownZero && takeoverCompleted && (
          <button
            type="button"
            className="ui-button ui-button--ghost"
            onClick={() => setDismissed(true)}
          >
            Entendido
          </button>
        )}
      </div>
    </section>
  );
}
