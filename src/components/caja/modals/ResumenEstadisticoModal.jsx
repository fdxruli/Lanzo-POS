// src/components/caja/modals/ResumenEstadisticoModal.jsx
import { X } from 'lucide-react';
import { Money } from '../../../utils/moneyMath';

/**
 * Modal para mostrar el resumen estadístico del turno
 *
 * @param {Object} props
 * @param {boolean} props.show - Controla la visibilidad del modal
 * @param {Function} props.onClose - Callback al cerrar el modal
 * @param {Object} props.resumenData - Datos del resumen estadístico
 * @param {number} props.maxCashThreshold - Límite máximo de caja para alertas
 * @param {boolean} [props.isDisabled=false] - Deshabilita la interacción
 */
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
      className="modal"
      style={{ display: 'flex', zIndex: 1300 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title-resumen"
    >
      <div className="modal-content" style={{ maxWidth: '650px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h2 className="modal-title" style={{ margin: 0 }} id="modal-title-resumen">
            📊 Resumen Estadístico del Turno
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isDisabled}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light)' }}
            aria-label="Cerrar modal"
          >
            <X size={20} />
          </button>
        </div>

        <div style={{ marginBottom: '20px' }}>
          {/* Métricas de tiempo y actividad */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '15px' }}>
            <div style={{ padding: '12px', backgroundColor: '#F3F4F6', borderRadius: '8px' }}>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-light)', margin: '0 0 5px 0' }}>
                Duración del Turno
              </p>
              <p style={{ fontSize: '1.1rem', fontWeight: 'bold', margin: 0 }}>
                {resumenData.tiempoTranscurrido.horas} horas
              </p>
            </div>
            <div style={{ padding: '12px', backgroundColor: '#DBEAFE', borderRadius: '8px' }}>
              <p style={{ fontSize: '0.8rem', color: '#1E40AF', margin: '0 0 5px 0' }}>
                Total Movimientos
              </p>
              <p style={{ fontSize: '1.1rem', fontWeight: 'bold', margin: 0 }}>
                {resumenData.totalMovimientos}
              </p>
            </div>
          </div>

          {/* Totales Financieros */}
          <h3 style={{
            fontSize: '0.95rem',
            color: 'var(--text-dark)',
            marginBottom: '10px',
            borderTop: '2px solid #E5E7EB',
            paddingTop: '15px'
          }}>
            💰 Totales Financieros
          </h3>

          <div style={{ display: 'grid', gap: '8px' }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '8px',
              backgroundColor: '#F9FAFB',
              borderRadius: '6px'
            }}>
              <span>Fondo Inicial</span>
              <span style={{ fontWeight: 'bold' }}>
                ${Money.toNumber(resumenData.fondoInicial).toFixed(2)}
              </span>
            </div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '8px',
              backgroundColor: '#F9FAFB',
              borderRadius: '6px'
            }}>
              <span>Ventas (Contado)</span>
              <span style={{ fontWeight: 'bold', color: 'var(--success-color)' }}>
                +${Money.toNumber(resumenData.ventasContado).toFixed(2)}
              </span>
            </div>
            {Money.init(resumenData.abonosFiado).gt(0) && (
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '8px',
                backgroundColor: '#F9FAFB',
                borderRadius: '6px'
              }}>
                <span>Abonos (Fiado)</span>
                <span style={{ fontWeight: 'bold', color: 'var(--warning-color)' }}>
                  +${Money.toNumber(resumenData.abonosFiado).toFixed(2)}
                </span>
              </div>
            )}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '8px',
              backgroundColor: '#F9FAFB',
              borderRadius: '6px'
            }}>
              <span>Entradas Extras</span>
              <span style={{ fontWeight: 'bold', color: 'var(--success-color)' }}>
                +${Money.toNumber(resumenData.entradasExtras).toFixed(2)}
              </span>
            </div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '8px',
              backgroundColor: '#FEF2F2',
              borderRadius: '6px'
            }}>
              <span>Salidas</span>
              <span style={{ fontWeight: 'bold', color: 'var(--error-color)' }}>
                -${Money.toNumber(resumenData.totalSalidas).toFixed(2)}
              </span>
            </div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '10px',
              backgroundColor: '#ECFDF5',
              borderRadius: '8px',
              borderTop: '2px solid #10B981'
            }}>
              <span style={{ fontWeight: 'bold' }}>Flujo Neto</span>
              <span style={{
                fontWeight: 'bold',
                fontSize: '1.2rem',
                color: 'var(--success-color)'
              }}>
                ${Money.toNumber(resumenData.flujoNeto).toFixed(2)}
              </span>
            </div>
          </div>

          {/* Métricas de Rendimiento */}
          <h3 style={{
            fontSize: '0.95rem',
            color: 'var(--text-dark)',
            margin: '20px 0 10px 0',
            borderTop: '2px solid #E5E7EB',
            paddingTop: '15px'
          }}>
            📈 Métricas de Rendimiento
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div style={{ padding: '10px', backgroundColor: '#FEF3C7', borderRadius: '8px' }}>
              <p style={{ fontSize: '0.75rem', color: '#92400E', margin: '0 0 4px 0' }}>
                Ventas por Hora
              </p>
              <p style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#78350F', margin: 0 }}>
                ${Money.toNumber(resumenData.ventasPorHora).toFixed(2)}
              </p>
            </div>
            <div style={{ padding: '10px', backgroundColor: '#E0E7FF', borderRadius: '8px' }}>
              <p style={{ fontSize: '0.75rem', color: '#3730A3', margin: '0 0 4px 0' }}>
                Ticket Promedio Est.
              </p>
              <p style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#312E81', margin: 0 }}>
                ${Money.toNumber(resumenData.ticketPromedioEstimado).toFixed(2)}
              </p>
            </div>
          </div>

          {/* Alertas */}
          {resumenData.alertas.excesoLiquidez && (
            <div style={{
              marginTop: '15px',
              padding: '12px',
              backgroundColor: '#FEF2F2',
              borderLeft: '4px solid #DC2626',
              borderRadius: '6px'
            }}>
              <p style={{ color: '#991B1B', fontWeight: 'bold', margin: '0 0 4px 0' }}>
                ⚠️ Exceso de Liquidez
              </p>
              <p style={{ color: '#7F1D1D', fontSize: '0.85rem', margin: 0 }}>
                El total en caja supera el límite sugerido de ${maxCashThreshold?.toLocaleString()}.
                Considere hacer un retiro de seguridad o corte parcial.
              </p>
            </div>
          )}

          {resumenData.alertas.salidasSignificativas && (
            <div style={{
              marginTop: '10px',
              padding: '12px',
              backgroundColor: '#FEF3C7',
              borderLeft: '4px solid #F59E0B',
              borderRadius: '6px'
            }}>
              <p style={{ color: '#92400E', fontWeight: 'bold', margin: '0 0 4px 0' }}>
                ℹ️ Salidas Significativas
              </p>
              <p style={{ color: '#78350F', fontSize: '0.85rem', margin: 0 }}>
                Las salidas representan más del 30% de los ingresos totales.
              </p>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            className="btn"
            onClick={onClose}
            disabled={isDisabled}
            style={{ backgroundColor: 'var(--primary-color)', color: 'white' }}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};

export default ResumenEstadisticoModal;
