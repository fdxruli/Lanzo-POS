import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ClipboardCheck, LoaderCircle } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import {
  getLicenseKeyFromDetails,
  isCloudCashSyncEnabled
} from '../../../services/sync/syncConstants';
import { postDowngradeCashReconciliation } from '../../../services/cash/postDowngradeCashReconciliation';
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

const ownerOnlyCode = 'POST_DOWNGRADE_CASH_OWNER_REQUIRED';

const CajaPostDowngradeReconciliationPanel = () => {
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
  const licenseKey = useMemo(() => getLicenseKeyFromDetails(licenseDetails), [licenseDetails]);
  const cloudCashEnabled = isCloudCashSyncEnabled(licenseDetails);

  const [cashSessions, setCashSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hiddenForActor, setHiddenForActor] = useState(false);
  const [error, setError] = useState('');
  const [selectedCashSessionId, setSelectedCashSessionId] = useState(null);

  const eligibleRuntime = Boolean(
    licenseKey
    && currentDeviceRole === 'admin'
    && !cloudCashEnabled
  );

  const loadPending = useCallback(async () => {
    if (!eligibleRuntime) {
      setCashSessions([]);
      setHiddenForActor(false);
      setError('');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const result = await postDowngradeCashReconciliation.list({ licenseKey });
      if (result?.success === false) {
        setCashSessions([]);
        setError(result.message || 'No se pudieron consultar las cajas pendientes del plan anterior.');
        return;
      }
      setHiddenForActor(false);
      setCashSessions(result.cashSessions || []);
    } catch (loadError) {
      if (loadError?.bridgeCode === ownerOnlyCode) {
        setHiddenForActor(true);
        setCashSessions([]);
        setError('');
        return;
      }
      setCashSessions([]);
      setError(loadError?.message || 'No se pudieron consultar las cajas pendientes del plan anterior.');
    } finally {
      setLoading(false);
    }
  }, [eligibleRuntime, licenseKey]);

  useEffect(() => {
    loadPending();
  }, [loadPending]);

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
    if (result?.closed) loadPending();
  }, [loadPending]);

  if (!eligibleRuntime || hiddenForActor) return null;
  if (!loading && !error && cashSessions.length === 0) return null;

  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

  return (
    <section className="ui-section caja-post-downgrade-reconciliation" aria-label="Cajas pendientes del plan anterior">
      <div className="ui-section__header">
        <div>
          <p className="ui-section__eyebrow">Conciliación histórica</p>
          <h2>Cajas pendientes del plan anterior</h2>
          <p>
            Estas cajas fueron abiertas antes del cambio a Lanzo Local. Puedes revisarlas y cerrarlas
            para completar la conciliación. Esto no habilita Caja Cloud en tu plan actual.
          </p>
        </div>
        {cashSessions.length > 0 && (
          <span className="ui-badge ui-badge--warning">{cashSessions.length} pendiente{cashSessions.length === 1 ? '' : 's'}</span>
        )}
      </div>

      {loading && (
        <p role="status"><LoaderCircle size={18} aria-hidden="true" /> Consultando cajas pendientes…</p>
      )}

      {error && (
        <div className="ui-alert ui-alert--warning" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <p>{error}</p>
          <button type="button" className="ui-button ui-button--secondary" onClick={loadPending}>
            Reintentar
          </button>
        </div>
      )}

      {!loading && cashSessions.length > 0 && (
        <div className="caja-business-cash-list">
          {cashSessions.map((session) => (
            <article className="caja-business-cash-item" key={session.id}>
              <div>
                <strong>{session.responsible_name || 'Responsable no disponible'}</strong>
                <p>{session.opening_device_name || 'Dispositivo no disponible'} · abierta {formatDate(session.opened_at)}</p>
                <p>Efectivo esperado: {formatMoney(session.expected_cash_total)}</p>
                {session.original_device_active === false && <small>El dispositivo original ya no está activo.</small>}
              </div>
              <button
                type="button"
                className="ui-button ui-button--secondary"
                onClick={() => setSelectedCashSessionId(session.id)}
                disabled={isOffline}
              >
                <ClipboardCheck size={17} aria-hidden="true" />
                Revisar y conciliar
              </button>
            </article>
          ))}
        </div>
      )}

      {isOffline && cashSessions.length > 0 && (
        <div className="ui-alert ui-alert--warning" role="status">
          <AlertTriangle size={18} aria-hidden="true" />
          <p>Conéctate a internet para revisar y cerrar una caja pendiente.</p>
        </div>
      )}

      <CajaAdminCashAuditModal
        cashSessionId={selectedCashSessionId}
        onClose={handleModalClose}
        getCashSessionDetailForAudit={getDetail}
        cerrarCajaAdministrativamente={closeCashSession}
        isReadOnly={isOffline}
      />
    </section>
  );
};

export default CajaPostDowngradeReconciliationPanel;
