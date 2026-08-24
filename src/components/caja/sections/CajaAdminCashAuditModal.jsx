import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, LoaderCircle, X } from 'lucide-react';
import { Money } from '../../../utils/moneyMath';
import { generateIdempotencyKey } from '../../../services/sync/idempotency';

const REASONS = [
  ['historical_test', 'Caja historica de pruebas'],
  ['device_replaced', 'Dispositivo reemplazado'],
  ['device_lost', 'Dispositivo perdido'],
  ['abandoned_session', 'Sesion abandonada'],
  ['operational_error', 'Error operativo'],
  ['other', 'Otro']
];

const formatMoney = (amount) => `$${Money.toNumber(amount ?? 0).toFixed(2)}`;
const date = (value) => value ? new Date(value).toLocaleString() : 'No disponible';
const age = (value) => {
  if (!value) return 'No disponible';
  const hours = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 3600000));
  return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} d`;
};
const sessionExpected = (session) => session?.expected_cash_total ?? session?.total_teorico_cloud ?? 0;
const movementAmount = (movement = {}) => movement.amount ?? movement.monto ?? 0;

const DetailValue = ({ label, children }) => (
  <span><small>{label}</small><strong>{children}</strong></span>
);

const CajaAdminCashAuditModal = ({
  cashSessionId,
  onClose,
  getCashSessionDetailForAudit,
  cerrarCajaAdministrativamente,
  isReadOnly = false
}) => {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('');
  const [countedAmount, setCountedAmount] = useState('');
  const [nextShiftFund, setNextShiftFund] = useState('0');
  const [reasonCode, setReasonCode] = useState('');
  const [comments, setComments] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const idempotencyKeyRef = useRef(null);

  useEffect(() => {
    if (!cashSessionId) return;
    let active = true;
    setLoading(true);
    setError('');
    setDetail(null);
    setMode('');
    setCountedAmount('');
    setNextShiftFund('0');
    setReasonCode('');
    setComments('');
    setConfirming(false);
    idempotencyKeyRef.current = null;
    getCashSessionDetailForAudit(cashSessionId, { force: true })
      .then((result) => {
        if (!active) return;
        if (result?.success === false) {
          setError(result.message || 'No se pudo cargar el detalle de esta caja.');
          return;
        }
        setDetail(result);
      })
      .catch((loadError) => active && setError(loadError?.message || 'No se pudo cargar el detalle de esta caja.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [cashSessionId, getCashSessionDetailForAudit]);

  const session = detail?.cashSession || null;
  const expected = useMemo(() => Money.init(sessionExpected(session)), [session]);
  const counted = useMemo(() => Money.init(countedAmount || 0), [countedAmount]);
  const nextFund = useMemo(() => Money.init(nextShiftFund || 0), [nextShiftFund]);
  const difference = useMemo(() => Money.subtract(counted, expected), [counted, expected]);
  const unverified = mode === 'admin_unverified';
  const audited = mode === 'admin_audited';
  const requiresComment = unverified || reasonCode === 'other';
  const canContinue = Boolean(
    session && mode && reasonCode && (!audited || (countedAmount !== '' && counted.gte(0) && nextFund.gte(0) && nextFund.lte(counted)))
    && (!unverified || nextFund.eq(0))
    && (!requiresComment || comments.trim().length > 0)
  );

  const submit = async () => {
    if (!canContinue || submitting) return;
    setSubmitting(true);
    setError('');
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = generateIdempotencyKey({
        entityType: 'cash_session',
        operation: 'admin_close',
        entityId: session.id,
        prefix: 'cash_admin_close'
      });
    }
    let closeResult = null;
    try {
      const result = await cerrarCajaAdministrativamente({
        cashSessionId: session.id,
        closingMode: mode,
        countedAmount: audited ? Money.toExactString(counted) : null,
        nextShiftFund: audited ? Money.toExactString(nextFund) : null,
        reasonCode,
        comments: comments.trim(),
        expectedVersion: session.serverVersion || session.server_version || null,
        idempotencyKey: idempotencyKeyRef.current
      });
      if (result?.success) {
        closeResult = { closed: true, cashSessionId: session.id };
      } else {
        const response = result?.response;
        const requiresReview = ['VERSION_CONFLICT', 'CASH_TOTALS_CHANGED'].includes(result?.code);
        if (requiresReview && response?.cash_session) {
          setDetail((current) => ({ ...current, cashSession: response.cash_session }));
          setConfirming(false);
          // The backend completed this attempt with a conflict response. A new human
          // confirmation is a new operation and must not replay that completed key.
          idempotencyKeyRef.current = null;
          setError(result?.code === 'CASH_TOTALS_CHANGED'
            ? 'La caja cambio mientras la revisabas. Actualizamos el efectivo esperado; revisa nuevamente los datos antes de confirmar.'
            : 'La caja cambio desde que la revisaste. Actualizamos los datos; vuelve a confirmar el cierre.');
        } else {
          setError(result?.message || 'No se pudo cerrar administrativamente la caja.');
        }
      }
    } catch (submitError) {
      setError(submitError?.message || 'No se pudo cerrar administrativamente la caja. Intenta nuevamente.');
    } finally {
      setSubmitting(false);
    }

    if (closeResult) onClose(closeResult);
  };

  if (!cashSessionId) return null;

  return (
    <div className="modal caja-modal caja-modal--admin-audit" role="dialog" aria-modal="true" aria-labelledby="admin-cash-audit-title">
      <div className="modal-content caja-modal__content caja-modal__content--medium">
        <header className="caja-modal__header">
          <span className="caja-modal__header-icon" aria-hidden="true"><ClipboardCheck size={22} /></span>
          <div className="caja-modal__heading"><p>Auditoria administrativa</p><h2 id="admin-cash-audit-title">Revisar y cerrar caja</h2></div>
          <button type="button" className="caja-modal__close" onClick={() => onClose()} disabled={submitting} aria-label="Cerrar"><X size={20} /></button>
        </header>
        <div className="caja-modal__body admin-cash-audit-body">
          {loading && <p className="admin-cash-audit-loading"><LoaderCircle size={18} /> Cargando detalle de caja...</p>}
          {error && <div className="caja-modal__notice caja-modal__notice--warning"><AlertTriangle size={18} /><p>{error}</p></div>}
          {session && (
            <>
              <div className="admin-cash-audit-summary">
                <DetailValue label="Responsable">{session.responsible_name || session.responsable_apertura || 'No disponible'}</DetailValue>
                <DetailValue label="Identidad">{session.cash_identity_state === 'legacy' ? 'Legacy' : 'CanÃ³nica'}</DetailValue>
                <DetailValue label="Dispositivo de apertura">{session.opened_by_device_name || session.device_name || session.opened_by_device_id || session.device_id || 'No disponible'}</DetailValue>
                <DetailValue label="Abierta">{date(session.opened_at || session.fecha_apertura)}</DetailValue>
                <DetailValue label="AntigÃ¼edad">{age(session.opened_at || session.fecha_apertura)}</DetailValue>
                <DetailValue label="Efectivo esperado">{formatMoney(expected)}</DetailValue>
                <DetailValue label="Ventas">{session.sales_count ?? 'No disponible'}</DetailValue>
              </div>
              <div className="admin-cash-audit-totals">
                <DetailValue label="Fondo inicial">{formatMoney(session.opening_amount ?? session.monto_inicial)}</DetailValue>
                <DetailValue label="Ventas efectivo">{formatMoney(session.cash_sales_total ?? session.ventas_efectivo)}</DetailValue>
                <DetailValue label="Abonos">{formatMoney(session.customer_payments_total ?? session.abonos_fiado)}</DetailValue>
                <DetailValue label="Entradas / Salidas">{formatMoney(session.cash_entries_total ?? session.entradas_efectivo)} / {formatMoney(session.cash_exits_total ?? session.salidas_efectivo)}</DetailValue>
              </div>
              <details className="admin-cash-audit-details"><summary>Movimientos ({detail.movements?.length || 0}) y eventos ({detail.auditEvents?.length || 0})</summary>
                <div className="admin-cash-audit-stream">{detail.movements?.map((movement) => <p key={movement.id}><strong>{movement.type || movement.tipo}</strong> {formatMoney(movementAmount(movement))} · {movement.concept || movement.concepto || 'Sin concepto'} · {date(movement.created_at || movement.fecha)}</p>)}</div>
                <div className="admin-cash-audit-stream">{detail.auditEvents?.map((event) => <p key={event.id}><strong>{event.event_type}</strong> · {event.actor_name || 'Sistema'} · {date(event.created_at)}</p>)}</div>
              </details>
              {isReadOnly ? <div className="caja-modal__notice caja-modal__notice--warning"><AlertTriangle size={18} /><p>El cierre administrativo requiere conexion. Esta caja solo puede revisarse sin conexion.</p></div> : !mode ? (
                <div className="admin-cash-audit-choice">
                  <p>Elige como se concilia esta caja.</p>
                  <button type="button" onClick={() => setMode('admin_audited')}><CheckCircle2 size={18} /> Conte fisicamente esta caja</button>
                  <button type="button" onClick={() => setMode('admin_unverified')}><AlertTriangle size={18} /> No existe un conteo fisico verificable</button>
                </div>
              ) : confirming ? (
                <div className="admin-cash-audit-confirm">
                  <h3>Confirmar cierre administrativo</h3>
                  <p>Caja: {session.responsible_name || session.responsable_apertura}</p>
                  <p>Tipo: {audited ? 'Cierre administrativo auditado' : 'Cierre administrativo sin conteo'}</p>
                  <p>Esperado: {formatMoney(expected)}</p>
                  <p>{audited ? `Contado: ${formatMoney(counted)} · Diferencia: ${formatMoney(difference)}` : 'Conteo fisico: No disponible · Diferencia: No determinada'}</p>
                  <p>Motivo: {REASONS.find(([code]) => code === reasonCode)?.[1]}</p>
                  <div className="caja-modal__actions"><button type="button" className="caja-modal__button caja-modal__button--secondary" onClick={() => setConfirming(false)} disabled={submitting}>Volver</button><button type="button" className="caja-modal__button caja-modal__button--primary" onClick={submit} disabled={submitting}>{submitting ? 'Cerrando...' : 'Confirmar cierre administrativo'}</button></div>
                </div>
              ) : (
                <div className="admin-cash-audit-form">
                  <button type="button" className="btn-clear-filters" onClick={() => setMode('')}>Cambiar modalidad</button>
                  {audited ? <>
                    <label>Efectivo contado<input type="number" min="0" step="0.01" value={countedAmount} onChange={(event) => setCountedAmount(event.target.value)} autoFocus /></label>
                    <label>Fondo siguiente turno<input type="number" min="0" step="0.01" value={nextShiftFund} onChange={(event) => setNextShiftFund(event.target.value)} /></label>
                    <p className="admin-cash-audit-difference">Diferencia orientativa: <strong>{formatMoney(difference)}</strong></p>
                  </> : <div className="caja-modal__notice caja-modal__notice--warning"><AlertTriangle size={18} /><p>Este cierre no afirma cuanto efectivo existia fisicamente. Conteo: No disponible. Diferencia: No determinada.</p></div>}
                  <label>Motivo<select value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}><option value="">Selecciona un motivo</option>{REASONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
                  <label>Comentarios {requiresComment && <span>Obligatorio</span>}<textarea rows="3" value={comments} onChange={(event) => setComments(event.target.value)} placeholder="Documenta el cierre administrativo" /></label>
                  <div className="caja-modal__actions"><button type="button" className="caja-modal__button caja-modal__button--secondary" onClick={() => onClose()}>Cancelar</button><button type="button" className="caja-modal__button caja-modal__button--primary" disabled={!canContinue} onClick={() => setConfirming(true)}>Revisar confirmacion</button></div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default CajaAdminCashAuditModal;
