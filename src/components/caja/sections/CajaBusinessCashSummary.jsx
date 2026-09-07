import { AlertTriangle, Building2, Clock3, UserRound, UsersRound } from 'lucide-react';
import { Money } from '../../../utils/moneyMath';
import {
  buildBusinessCashSummary,
  getCashSessionAge,
  getCashSessionStationLabel,
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

const formatOpenedAt = (value) => {
  if (!value) return 'Hora de apertura no disponible';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Hora de apertura no disponible'
    : date.toLocaleString();
};

const getExpectedCash = (session = {}) => (
  session.expected_cash_total ?? session.total_teorico_cloud ?? 0
);

const CajaBusinessCashSummary = ({
  adminOpenSessions = [],
  cajaActual = null,
  onReviewSession = null,
  isReadOnly = false
}) => {
  const summary = buildBusinessCashSummary(adminOpenSessions, cajaActual);

  return (
    <section className="caja-card business-cash-card" aria-labelledby="business-cash-title">
      <div className="section-header">
        <div className="section-heading">
          <span className="section-heading-icon" aria-hidden="true"><Building2 size={19} /></span>
          <div>
            <p className="section-eyebrow">Estaciones físicas</p>
            <h2 id="business-cash-title" className="section-title">Cajas abiertas por estación</h2>
          </div>
        </div>
        <span className="items-count">
          {summary.openCount} {summary.openCount === 1 ? 'estación abierta' : 'estaciones abiertas'}
        </span>
      </div>

      {summary.otherAdminCount > 0 && (
        <div className="cash-opening-notice cash-opening-notice--warning" role="status">
          <AlertTriangle size={18} aria-hidden="true" />
          <p>
            Tienes {summary.otherAdminCount} otra{summary.otherAdminCount === 1 ? '' : 's'} estación
            {summary.otherAdminCount === 1 ? '' : 'es'} admin abierta
            {summary.otherAdminCount === 1 ? '' : 's'}. Cada caja mantiene su monto separado.
          </p>
        </div>
      )}

      <div className="business-cash-list" aria-label="Cajas abiertas por estación física">
        <h3>Detalle por estación</h3>
        {summary.sessions.map((session) => {
          const age = getCashSessionAge(getOpenedAt(session));
          const isStaff = isStaffCashSession(session);
          const type = isStaff ? 'Staff' : 'Admin';
          return (
            <article key={session.id || session.cash_session_id} className="business-cash-session">
              <div>
                <strong>{getCashSessionStationLabel(session)}</strong>
                <span className="business-cash-session-meta"><UserRound size={13} aria-hidden="true" />{type}</span>
                <span className="business-cash-session-meta">Responsable: {getResponsibleName(session)}</span>
                <span className="business-cash-session-meta">Abierta: {formatOpenedAt(getOpenedAt(session))}</span>
              </div>
              <div className="business-cash-session-value">
                <strong>{formatMoney(getExpectedCash(session))}</strong>
                <span>Efectivo teórico</span>
                <span>Estado: Abierta</span>
                <span className={`business-cash-age business-cash-age--${age.level}`} title={age.detail || age.label}>
                  {age.level !== 'normal' && <AlertTriangle size={13} aria-hidden="true" />}
                  <Clock3 size={13} aria-hidden="true" />{age.label}
                </span>
              </div>
              {onReviewSession && (
                <button type="button" className="business-cash-review" onClick={() => onReviewSession(session)} disabled={isReadOnly}>
                  {isReadOnly ? 'Sin conexión' : 'Revisar'}
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
