import { History, ShieldAlert } from 'lucide-react';
import { Money } from '../../../utils/moneyMath';
import { getOpeningDeviceLabel } from '../../../services/cash/cashDeviceLabel';

const formatDate = (value) => (value ? new Date(value).toLocaleString() : 'Fecha no disponible');

export default function CajaLegacyCashTransition({ sessions = [], isReadOnly = false, onAdopt, onReview }) {
  if (!sessions.length) return null;

  return (
    <section className="ui-card ui-card--compact caja-card" aria-labelledby="legacy-cash-transition-title">
      <div className="caja-opening-heading">
        <span className="caja-opening-icon" aria-hidden="true"><ShieldAlert size={24} /></span>
        <div>
          <p className="section-eyebrow">Transición de identidad</p>
          <h2 id="legacy-cash-transition-title">Encontramos cajas administrativas anteriores</h2>
        </div>
      </div>
      <p>No se combinarán automáticamente. Elige una caja para continuarla con tu identidad actual o revísala antes de cerrarla.</p>
      <div className="caja-history-list">
        {sessions.map((session) => (
          <article key={session.id} className="caja-history-item">
            <div>
              <strong>{session.responsible_name || 'Administrador'} · ${Money.toNumber(session.expected_cash_total || 0).toFixed(2)}</strong>
              <small>Abierta: {formatDate(session.opened_at)} · Dispositivo original: {getOpeningDeviceLabel(session)}</small>
            </div>
            <div className="ui-section__actions">
              <button type="button" className="ui-button ui-button--secondary btn btn-secondary" onClick={() => onReview?.(session)}>
                <History size={16} aria-hidden="true" /> Revisar
              </button>
              <button type="button" className="ui-button ui-button--primary btn btn-primary" disabled={isReadOnly} onClick={() => onAdopt?.(session)}>
                Continuar esta caja
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
