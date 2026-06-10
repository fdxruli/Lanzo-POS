import {
  Activity,
  AlertTriangle,
  BarChart3,
  Clock3,
  Info,
  ReceiptText,
  TrendingUp,
  X
} from 'lucide-react';
import { Money } from '../../../utils/moneyMath';

const ResumenEstadisticoModal = ({
  show,
  onClose,
  resumenData,
  maxCashThreshold,
  isDisabled = false
}) => {
  if (!show || !resumenData) return null;

  return (
    <div
      className="modal caja-modal caja-modal--summary"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title-resumen"
    >
      <div className="modal-content caja-modal__content caja-modal__content--wide">
        <header className="caja-modal__header">
          <span className="caja-modal__header-icon" aria-hidden="true">
            <BarChart3 size={22} />
          </span>
          <div className="caja-modal__heading">
            <p>Rendimiento del turno</p>
            <h2 id="modal-title-resumen">Resumen estadístico</h2>
          </div>
          <button
            type="button"
            className="caja-modal__close"
            onClick={onClose}
            disabled={isDisabled}
            aria-label="Cerrar modal"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="caja-modal__body caja-summary">
          <div className="caja-summary__quick-stats">
            <article>
              <span className="caja-summary__stat-icon" aria-hidden="true"><Clock3 size={19} /></span>
              <div>
                <p>Duración del turno</p>
                <strong>{resumenData.tiempoTranscurrido.horas} horas</strong>
              </div>
            </article>
            <article>
              <span className="caja-summary__stat-icon" aria-hidden="true"><Activity size={19} /></span>
              <div>
                <p>Total de movimientos</p>
                <strong>{resumenData.totalMovimientos}</strong>
              </div>
            </article>
          </div>

          <section className="caja-summary__section" aria-labelledby="financial-totals-title">
            <div className="caja-summary__section-heading">
              <ReceiptText size={18} aria-hidden="true" />
              <h3 id="financial-totals-title">Totales financieros</h3>
            </div>
            <div className="caja-summary__ledger">
              <div><span>Fondo inicial</span><strong>${Money.toNumber(resumenData.fondoInicial).toFixed(2)}</strong></div>
              <div><span>Ventas de contado</span><strong className="positive">+${Money.toNumber(resumenData.ventasContado).toFixed(2)}</strong></div>
              {Money.init(resumenData.abonosFiado).gt(0) && (
                <div><span>Abonos de fiado</span><strong className="warning">+${Money.toNumber(resumenData.abonosFiado).toFixed(2)}</strong></div>
              )}
              <div><span>Entradas extras</span><strong className="positive">+${Money.toNumber(resumenData.entradasExtras).toFixed(2)}</strong></div>
              <div><span>Salidas</span><strong className="negative">-${Money.toNumber(resumenData.totalSalidas).toFixed(2)}</strong></div>
              <div className="caja-summary__total">
                <span>Flujo neto</span>
                <strong>${Money.toNumber(resumenData.flujoNeto).toFixed(2)}</strong>
              </div>
            </div>
          </section>

          <section className="caja-summary__section" aria-labelledby="performance-title">
            <div className="caja-summary__section-heading">
              <TrendingUp size={18} aria-hidden="true" />
              <h3 id="performance-title">Métricas de rendimiento</h3>
            </div>
            <div className="caja-summary__performance">
              <article>
                <p>Ventas por hora</p>
                <strong>${Money.toNumber(resumenData.ventasPorHora).toFixed(2)}</strong>
              </article>
              <article>
                <p>Ticket promedio estimado</p>
                <strong>${Money.toNumber(resumenData.ticketPromedioEstimado).toFixed(2)}</strong>
              </article>
            </div>
          </section>

          {(resumenData.alertas.excesoLiquidez || resumenData.alertas.salidasSignificativas) && (
            <section className="caja-summary__alerts" aria-label="Alertas del turno">
              {resumenData.alertas.excesoLiquidez && (
                <div className="caja-modal__notice caja-modal__notice--danger">
                  <AlertTriangle size={19} aria-hidden="true" />
                  <div>
                    <strong>Exceso de liquidez</strong>
                    <p>
                      El total supera el límite sugerido de ${maxCashThreshold?.toLocaleString()}.
                      Considera un retiro de seguridad o corte parcial.
                    </p>
                  </div>
                </div>
              )}
              {resumenData.alertas.salidasSignificativas && (
                <div className="caja-modal__notice caja-modal__notice--warning">
                  <Info size={19} aria-hidden="true" />
                  <div>
                    <strong>Salidas significativas</strong>
                    <p>Las salidas representan más del 30% de los ingresos totales.</p>
                  </div>
                </div>
              )}
            </section>
          )}

          <footer className="caja-modal__actions">
            <button
              className="caja-modal__button caja-modal__button--primary"
              onClick={onClose}
              disabled={isDisabled}
            >
              Cerrar resumen
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
};

export default ResumenEstadisticoModal;
