import { useEffect, useState } from 'react';
import { CheckCircle2, CloudOff, RefreshCw, Store, WalletCards } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import usePostDowngradeCashPending, {
  consumeFreeDeviceTakeoverCompleted
} from '../../hooks/usePostDowngradeCashPending';
import {
  buildPostDowngradeCashAttentionKey,
  clearPostDowngradeCashAttention,
  markPostDowngradeCashAttentionDisplayed,
  markPostDowngradeCashAttentionRead,
  postponePostDowngradeCashAttention,
  POST_DOWNGRADE_CASH_ATTENTION_EVENT,
  readPostDowngradeCashAttention
} from '../../services/cash/postDowngradeCashAttention';

const EMPTY_ATTENTION = {
  key: null,
  record: null,
  ready: false,
  visible: false,
  path: null
};

export default function PostDowngradeRecoveryBanner({ isSuppressed = false } = {}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const {
    eligible,
    online,
    status,
    pendingCount,
    isPostDowngrade,
    downgradedAt,
    error,
    refresh,
    scopeKey
  } = usePostDowngradeCashPending();
  const [takeoverCompleted, setTakeoverCompleted] = useState(false);
  const [takeoverDismissed, setTakeoverDismissed] = useState(false);
  const [attention, setAttention] = useState(EMPTY_ATTENTION);

  useEffect(() => {
    setTakeoverDismissed(false);
    setTakeoverCompleted(consumeFreeDeviceTakeoverCompleted(scopeKey));
  }, [scopeKey]);

  const hasKnownPending = Number.isInteger(pendingCount) && pendingCount > 0;
  const hasKnownZero = pendingCount === 0;

  useEffect(() => {
    let current = true;

    if (!eligible || !scopeKey || !hasKnownPending) {
      setAttention(EMPTY_ATTENTION);

      if (eligible && scopeKey && isPostDowngrade && hasKnownZero) {
        void buildPostDowngradeCashAttentionKey({
          scopeKey,
          downgradedAt
        }).then((key) => {
          if (current) clearPostDowngradeCashAttention(key);
        });
      }

      return () => {
        current = false;
      };
    }

    setAttention({ ...EMPTY_ATTENTION, path: pathname });
    void buildPostDowngradeCashAttentionKey({
      scopeKey,
      downgradedAt
    }).then((key) => {
      if (!current) return;
      const record = readPostDowngradeCashAttention(key);
      const alreadyAcknowledged = Boolean(record.readAt || record.postponedAt);
      const nextRecord = alreadyAcknowledged
        ? record
        : markPostDowngradeCashAttentionDisplayed(key);
      setAttention({
        key,
        record: nextRecord,
        ready: true,
        visible: !alreadyAcknowledged,
        path: pathname
      });
    });

    return () => {
      current = false;
    };
  }, [
    downgradedAt,
    eligible,
    hasKnownPending,
    hasKnownZero,
    isPostDowngrade,
    pathname,
    scopeKey
  ]);

  useEffect(() => {
    if (!attention.key || !attention.visible || !attention.path || attention.path === pathname) return;
    const record = markPostDowngradeCashAttentionRead(attention.key, {
      source: 'route-navigation'
    });
    setAttention((current) => ({ ...current, record, visible: false }));
  }, [attention.key, attention.path, attention.visible, pathname]);

  useEffect(() => {
    if (!attention.key || typeof window === 'undefined') return undefined;

    const handleAttentionChange = (event) => {
      const change = event?.detail;
      if (change?.key !== attention.key || change?.source === 'initial-notice') return;
      if (change?.action === 'displayed' || change?.action === 'resolved') return;

      const record = readPostDowngradeCashAttention(attention.key);
      setAttention((current) => ({ ...current, record, visible: false }));
    };

    window.addEventListener(POST_DOWNGRADE_CASH_ATTENTION_EVENT, handleAttentionChange);
    return () => window.removeEventListener(POST_DOWNGRADE_CASH_ATTENTION_EVENT, handleAttentionChange);
  }, [attention.key]);

  const showCashNotice = Boolean(
    !isSuppressed && eligible && hasKnownPending && attention.ready && attention.visible
  );
  const showTakeoverNotice = Boolean(
    !isSuppressed && eligible && takeoverCompleted && !takeoverDismissed && !hasKnownPending
  );
  const showVerificationNotice = Boolean(
    !isSuppressed && eligible && isPostDowngrade && !hasKnownPending && !hasKnownZero
    && ['error', 'unknown'].includes(status)
  );

  const handleReviewCash = () => {
    if (attention.key) {
      const record = markPostDowngradeCashAttentionRead(attention.key, {
        source: 'initial-notice-review'
      });
      setAttention((current) => ({ ...current, record, visible: false }));
    }
    navigate('/caja');
  };

  const handlePostponeCash = () => {
    const record = postponePostDowngradeCashAttention(attention.key);
    setAttention((current) => ({ ...current, record, visible: false }));
  };

  if (showCashNotice) {
    const staleOfflineCount = !online || status === 'offline_known';

    return (
      <section
        className="post-downgrade-banner post-downgrade-banner--attention"
        role="status"
        aria-live="polite"
        aria-busy={status === 'loading'}
        aria-label="Cajas pendientes de conciliación del plan anterior"
      >
        <div className="post-downgrade-banner__icon" aria-hidden="true">
          {staleOfflineCount ? <CloudOff size={20} /> : <WalletCards size={20} />}
        </div>

        <div className="post-downgrade-banner__content">
          <strong>
            {pendingCount} caja{pendingCount === 1 ? '' : 's'} anterior{pendingCount === 1 ? '' : 'es'} pendiente{pendingCount === 1 ? '' : 's'}
          </strong>
          <p>Puedes revisarlas cuando estés listo. Tu operación en Lanzo Local puede continuar.</p>
          {staleOfflineCount && (
            <p className="post-downgrade-banner__hint">
              Sin conexión: esta es la última cantidad confirmada. Conéctate para actualizarla o conciliar.
            </p>
          )}
          {status === 'error' && (
            <p className="post-downgrade-banner__hint">
              No pudimos actualizarla. Conservamos la última cantidad confirmada.
            </p>
          )}
        </div>

        <div className="post-downgrade-banner__actions">
          <button
            type="button"
            className="ui-button ui-button--secondary"
            onClick={handleReviewCash}
          >
            <WalletCards size={17} aria-hidden="true" />
            Revisar cajas
          </button>
          <button
            type="button"
            className="ui-button ui-button--ghost"
            onClick={handlePostponeCash}
          >
            Más tarde
          </button>
        </div>
      </section>
    );
  }

  if (showTakeoverNotice) {
    return (
      <section
        className="post-downgrade-banner post-downgrade-banner--recovery"
        role="status"
        aria-live="polite"
        aria-label="Recuperación del dispositivo completada"
      >
        <div className="post-downgrade-banner__icon" aria-hidden="true">
          <CheckCircle2 size={20} />
        </div>
        <div className="post-downgrade-banner__content">
          <strong>Este dispositivo ya está activo</strong>
          <p>Lanzo Local está listo en este dispositivo. Revisa las ventas, caja y sincronizaciones pendientes antes de continuar.</p>
        </div>
        <div className="post-downgrade-banner__actions">
          <button
            type="button"
            className="ui-button ui-button--ghost"
            onClick={() => setTakeoverDismissed(true)}
          >
            Entendido
          </button>
        </div>
      </section>
    );
  }

  if (showVerificationNotice) {
    return (
      <section
        className="post-downgrade-banner post-downgrade-banner--recovery"
        role="status"
        aria-live="polite"
        aria-busy={status === 'loading'}
        aria-label="Verificación de cajas del plan anterior"
      >
        <div className="post-downgrade-banner__icon" aria-hidden="true">
          {online ? <Store size={20} /> : <CloudOff size={20} />}
        </div>
        <div className="post-downgrade-banner__content">
          <strong>No pudimos verificar las cajas del plan anterior</strong>
          <p>{error || 'La verificación quedó pendiente. Tu operación en Lanzo Local puede continuar.'}</p>
        </div>
        {online && (
          <div className="post-downgrade-banner__actions">
            <button
              type="button"
              className="ui-button ui-button--secondary"
              onClick={() => refresh()}
            >
              <RefreshCw size={17} aria-hidden="true" />
              Reintentar
            </button>
          </div>
        )}
      </section>
    );
  }

  return null;
}
