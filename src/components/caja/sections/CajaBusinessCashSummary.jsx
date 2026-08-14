import { AlertTriangle, Building2, Clock3, UserRound, UsersRound, WalletCards } from 'lucide-react';
import { Money } from '../../../utils/moneyMath';
import {
  buildBusinessCashSummary,
  getCashSessionAge,
  isStaffCashSession
} from '../../../services/cash/businessCashSummary';

const formatMoney = (value) => `$${Money.toNumber(value || 0).toFixed(2)}`;

const getResponsibleName = (session = {}) => (
  session.responsible_name ||
  session.responsibleName ||
  session.responsable_apertura ||
  session.staff_display_name ||
  session.staffDisplayName ||
  'Responsable no asignado'
);

const getOpenedAt = (session = {}) => session.opened_at || session.fecha_apertura;

const getExpectedCash = (session = {}) => (
  session.expected_cash_total ?? session.total_teorico_cloud ?? 0
);

const CajaBusinessCashSummary = ({ adminOpenSessions = [], cajaActual = null, onReviewSession = null, isReadOnly = false }) => {
  const summary = buildBusinessCashSummary(adminOpenSessions, cajaActual);

  return (
    <section className="caja-card business-cash-card" aria-labelledby="business-cash-title">
      <div className="section-header">
        <div className="section-heading">
          <span className="section-heading-icon" aria-hidden="true"><Building2 size={19} /></span>
          <div>
            <p className="section-eyebrow">Resumen consolidado</p>
            <h2 id="business-cash-title" className="section-title">Efectivo del negocio</h2>
          </div>
        </div>
        <span className="items-count">{summary.openCount} abiertas</span>
      </div>

      <div className="business-cash-hero">
        <WalletCards size={22} aria-hidden="true" />
        <div><strong>{formatMoney(summary.expectedCashTotal)}</strong><span>Efectivo teórico</span></div>
      </div>
      <p className="business-cash-help">El efectivo teórico se calcula con las cajas abiertas registradas en Lanzo.</p>

      <div className="business-cash-breakdown" aria-label="Distribución del efectivo del negocio">
        <span><small>Mi caja</small><strong>{formatMoney(summary.currentActorTotal)}</strong></span>
        <span><small>Otras cajas admin</small><strong>{formatMoney(summary.otherAdminTotal)}</strong></span>
        <span><small>Cajas staff</small><strong>{formatMoney(summary.staffTotal)}</strong></span>
      </div>

      <div className="business-cash-components" aria-label="Componentes del efectivo teórico">
        <span>Fondo inicial <strong>{formatMoney(summary.openingTotal)}</strong></span>
        <span>Ventas efectivo <strong>{formatMoney(summary.cashSalesTotal)}</strong></span>
        <span>Abonos <strong>{formatMoney(summary.customerPaymentsTotal)}</strong></span>
        <span>Entradas <strong>{formatMoney(summary.entriesTotal)}</strong></span>
        <span>Salidas <strong>- {formatMoney(summary.exitsTotal)}</strong></span>
      </div>

      <div className="business-cash-list" aria-label="Cajas abiertas de la licencia">
        <h3>Cajas abiertas</h3>
        {summary.sessions.map((session) => {
          const age = getCashSessionAge(getOpenedAt(session));
          const isStaff = isStaffCashSession(session);
          const type = isStaff ? 'Staff' : 'Admin';
          return (
            <article key={session.id || session.cash_session_id} className="business-cash-session">
              <div>
                <strong>{getResponsibleName(session)}</strong>
                <span className="business-cash-session-meta"><UserRound size={13} aria-hidden="true" />{type}</span>
              </div>
              <div className="business-cash-session-value">
                <strong>{formatMoney(getExpectedCash(session))}</strong>
                <span className={`business-cash-age business-cash-age--${age.level}`} title={age.detail || age.label}>
                  {age.level !== 'normal' && <AlertTriangle size={13} aria-hidden="true" />}
                  <Clock3 size={13} aria-hidden="true" />{age.label}
                </span>
              </div>
              {onReviewSession && (
                <button type="button" className="business-cash-review" onClick={() => onReviewSession(session)} disabled={isReadOnly}>
                  {isReadOnly ? 'Sin conexion' : 'Revisar'}
                </button>
              )}
            </article>
          );
        })}
        {summary.openCount === 0 && (
          <p className="business-cash-empty"><UsersRound size={17} aria-hidden="true" />No hay cajas abiertas en este momento.</p>
        )}
      </div>
    </section>
  );
};

export default CajaBusinessCashSummary;
