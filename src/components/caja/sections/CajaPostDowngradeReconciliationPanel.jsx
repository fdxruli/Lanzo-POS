import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight, ClipboardCheck, LoaderCircle } from 'lucide-react';
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
  const [showAll, setShowAll] = useState(false);

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
    <section className="caja-post-downgrade-reconciliation" aria-label="Cajas pendientes del plan anterior" aria-labelledby="post-downgrade-cash-title" aria-busy={loading}>
      <div className="caja-post-downgrade__heading">
        <div>
          <p className="section-eyebrow">Historial de Lanzo Nube</p>
          <h2 id="post-downgrade-cash-title">Cajas del plan anterior</h2>
        </div>
        {hasPending && (
          <span className="ui-badge ui-badge--warning">
            {pendingCount} pendiente{pendingCount === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <p className="caja-post-downgrade__hint">
        Revisa y concilia las cajas de tu plan anterior. Esto no activa Caja Nube.
      </p>
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
        <>
          <div className="caja-post-downgrade__list" role="list" aria-label="Sesiones pendientes de conciliación">
            {(showAll ? cashSessions : cashSessions.slice(0, 3)).map((session) => (
              <article className="caja-post-downgrade__item" role="listitem" key={session.id}>
                <div className="caja-post-downgrade__row">
                  <div className="caja-post-downgrade__identity">
                    <strong className="caja-post-downgrade__name">
                      {session.responsible_name || 'Responsable no disponible'}
                    </strong>
                    <span className="caja-post-downgrade__device">
                      {session.opening_device_name || 'Dispositivo no disponible'}
                    </span>
                    <span className="caja-post-downgrade__date">Abierta: {formatDate(session.opened_at)}</span>
                  </div>
                  <div className="caja-post-downgrade__amount">
                    <small>Efectivo esperado</small>
                    <strong>{formatMoney(session.expected_cash_total)}</strong>
                  </div>
                </div>
                <div className="caja-post-downgrade__foot">
                  {session.original_device_active === false && (
                    <span className="caja-post-downgrade__inactive">
                      <AlertTriangle size={14} aria-hidden="true" /> Dispositivo inactivo
                    </span>
                  )}
                  <button
                    type="button"
                    className="caja-post-downgrade__review"
                    onClick={() => setSelectedCashSessionId(session.id)}
                    disabled={!online}
                    aria-describedby={!online ? 'post-downgrade-cash-offline-help' : undefined}
                    aria-label={'Revisar y conciliar caja de ' + (session.responsible_name || 'responsable no disponible')}
                  >
                    <ClipboardCheck size={17} aria-hidden="true" />
                    Revisar y conciliar
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </div>
              </article>
            ))}
          </div>
          {cashSessions.length > 3 && (
            <button
              type="button"
              className="caja-post-downgrade__more"
              onClick={() => setShowAll((current) => !current)}
              aria-expanded={showAll}
            >
              {showAll ? 'Mostrar menos' : 'Ver todas las cajas (' + cashSessions.length + ')'}
            </button>
          )}
        </>
      )}
      {(isOfflineKnown || (!online && hasPending)) && (
        <div id="post-downgrade-cash-offline-help" className="ui-alert ui-alert--warning" role="status">
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
