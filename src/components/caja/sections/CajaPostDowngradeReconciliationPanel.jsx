import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, ClipboardCheck, LoaderCircle } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { getLicenseKeyFromDetails } from '../../../services/sync/syncConstants';
import { postDowngradeCashReconciliation } from '../../../services/cash/postDowngradeCashReconciliation';
import usePostDowngradeCashPending from '../../../hooks/usePostDowngradeCashPending';
import CajaAdminCashAuditModal from './CajaAdminCashAuditModal';

const formatMoney = (value) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? `$${parsed.toFixed(2)}` : '$0.00';
};

const formatDate = (value) => {
  if (!value) return 'No disponible';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'No disponible' : parsed.toLocaleString();
};

const CajaPostDowngradeReconciliationPanel = () => {
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const licenseKey = useMemo(() => getLicenseKeyFromDetails(licenseDetails), [licenseDetails]);
  const {
    eligible,
    online,
    status,
    pendingCount,
    cashSessions,
    isPostDowngrade,
    error,
    refresh
  } = usePostDowngradeCashPending();
  const [selectedCashSessionId, setSelectedCashSessionId] = useState(null);

  const loading = status === 'loading';
  const hasPending = Number.isInteger(pendingCount) && pendingCount > 0;
  const isOfflineKnown = status === 'offline_known';
  const canShowHistoricalSurface = isPostDowngrade || hasPending;

  const getDetail = useCallback(async (cashSessionId) => (
    postDowngradeCashReconciliation.detail({ licenseKey, cashSessionId })
  ), [licenseKey]);

  const closeCashSession = useCallback(async (request) => (
    postDowngradeCashReconciliation.close({
      licenseKey,
      cashSessionId: request.cashSessionId,
      closingMode: request.closingMode,
      countedAmount: request.countedAmount,
      nextShiftFund: request.nextShiftFund,
      reasonCode: request.reasonCode,
      comments: request.comments,
      expectedVersion: request.expectedVersion,
      idempotencyKey: request.idempotencyKey
    })
  ), [licenseKey]);

  const handleModalClose = useCallback((result = null) => {
    setSelectedCashSessionId(null);
    if (result?.closed) void refresh();
  }, [refresh]);

  if (!eligible || status === 'hidden') return null;
  if (!canShowHistoricalSurface && loading) return null;
  if (!canShowHistoricalSurface && ['unknown', 'error'].includes(status)) return null;
  if (!loading && !error && pendingCount === 0) return null;

  return (
    <section
      className="ui-section caja-post-downgrade-reconciliation"
      aria-label="Cajas pendientes del plan anterior"
      aria-busy={loading}
    >
      <div className="ui-section__header">
        <div>
          <p className="ui-section__eyebrow">Historial del plan anterior</p>
          <h2>Cajas pendientes del plan anterior</h2>
          <p>
            Estas cajas fueron abiertas mientras tu negocio utilizaba Lanzo Nube.
            Puedes revisarlas y cerrarlas para dejar el historial conciliado.
            Esto no activa Caja Cloud en tu plan actual.
          </p>
        </div>
        {hasPending && (
          <span className="ui-badge ui-badge--warning">
            {pendingCount} pendiente{pendingCount === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {loading && (
        <p role="status" aria-live="polite">
          <LoaderCircle size={18} aria-hidden="true" /> Consultando cajas pendientes…
        </p>
      )}

      {error && canShowHistoricalSurface && (
        <div className="ui-alert ui-alert--warning" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <p>{error || 'No pudimos verificar si existen cajas pendientes del plan anterior.'}</p>
            {!online && <p>Conéctate a internet para volver a consultar este historial.</p>}
          </div>
          {online && (
            <button type="button" className="ui-button ui-button--secondary" onClick={() => refresh()}>
              Reintentar
            </button>
          )}
        </div>
      )}

      {!loading && hasPending && (
        <div className="caja-business-cash-list">
          {cashSessions.map((session) => (
            <article className="caja-business-cash-item" key={session.id}>
              <div>
                <strong>{session.responsible_name || 'Responsable no disponible'}</strong>
                <p>{session.opening_device_name || 'Dispositivo no disponible'} · abierta {formatDate(session.opened_at)}</p>
                <p>Efectivo esperado: {formatMoney(session.expected_cash_total)}</p>
                {session.original_device_active === false && (
                  <small>El dispositivo donde se abrió esta caja ya no está activo.</small>
                )}
              </div>
              <button
                type="button"
                className="ui-button ui-button--secondary"
                onClick={() => setSelectedCashSessionId(session.id)}
                disabled={!online}
                aria-describedby={!online ? 'post-downgrade-cash-offline-help' : undefined}
              >
                <ClipboardCheck size={17} aria-hidden="true" />
                Revisar y conciliar
              </button>
            </article>
          ))}
        </div>
      )}

      {(isOfflineKnown || (!online && hasPending)) && (
        <div
          id="post-downgrade-cash-offline-help"
          className="ui-alert ui-alert--warning"
          role="status"
        >
          <AlertTriangle size={18} aria-hidden="true" />
          <p>Conéctate a internet para revisar y cerrar las cajas pendientes.</p>
        </div>
      )}

      <CajaAdminCashAuditModal
        cashSessionId={selectedCashSessionId}
        onClose={handleModalClose}
        getCashSessionDetailForAudit={getDetail}
        cerrarCajaAdministrativamente={closeCashSession}
        isReadOnly={!online}
      />
    </section>
  );
};

export default CajaPostDowngradeReconciliationPanel;
