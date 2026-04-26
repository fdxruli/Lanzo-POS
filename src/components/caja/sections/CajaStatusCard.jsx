// src/components/caja/sections/CajaStatusCard.jsx
import { Pencil, Save, Printer } from 'lucide-react';
import { Money } from '../../../utils/moneyMath';

/**
 * Tarjeta de estado de la caja - Muestra información del turno activo y controles principales
 *
 * @param {Object} props
 * @param {Object} props.cajaActual - Datos de la caja actual
 * @param {Object} props.totalesTurno - Totales acumulados del turno
 * @param {boolean} props.excesoLiquidez - Alerta de exceso de liquidez
 * @param {number} props.porcentajeLiquidez - Porcentaje del límite alcanzado
 * @param {Date|null} props.lastSyncTime - Última sincronización
 * @param {Date|null} props.lastActivity - Última actividad del usuario
 * @param {boolean} props.isActive - Si el usuario está activo ahora
 * @param {Object} props.CAJA_CONFIG - Configuración de caja (MAX_CASH_THRESHOLD)
 * @param {boolean} props.isBackupLoading - Estado de carga del backup
 * @param {Function} props.onEditarFondoInicial - Callback al editar fondo inicial
 * @param {Function} props.onBackup - Callback al hacer backup
 * @param {Function} props.onReporte - Callback al descargar reporte CSV
 * @param {Function} props.onResumen - Callback al ver resumen estadístico
 * @param {Function} props.onImprimir - Callback al imprimir
 */
const CajaStatusCard = ({
  cajaActual,
  totalesTurno,
  excesoLiquidez,
  porcentajeLiquidez,
  lastSyncTime,
  lastActivity,
  isActive,
  CAJA_CONFIG,
  isBackupLoading,
  onEditarFondoInicial,
  onBackup,
  onReporte,
  onResumen,
  onImprimir
}) => {
  // Cálculo del total actual en tiempo real ESTRICTO
  let totalEnCajaSafe = Money.init(0);

  if (cajaActual) {
    const inicial = Money.init(cajaActual.monto_inicial || 0);
    const ventas = Money.init(totalesTurno.ventasContado || 0);
    const abonos = Money.init(totalesTurno.abonosFiado || 0);
    const entradas = Money.init(cajaActual.entradas_efectivo || 0);
    const salidas = Money.init(cajaActual.salidas_efectivo || 0);

    const subtotalIngresos = Money.add(inicial, ventas);
    const subtotalExtras = Money.add(abonos, entradas);
    const ingresosTotales = Money.add(subtotalIngresos, subtotalExtras);

    totalEnCajaSafe = Money.subtract(ingresosTotales, salidas);
  }

  return (
    <div className="caja-card status-card">
      <div className="status-header">
        {/* Columna izquierda: Badges + Meta + Liquidez */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          {/* Badges de estado */}
          <div className="status-badges">
            <span className="status-badge open">Turno Activo</span>
            {excesoLiquidez && (
              <span
                className="status-badge"
                style={{ backgroundColor: '#FCA5A5', color: '#991B1B' }}
                title={`Excede el límite sugerido de $${CAJA_CONFIG?.MAX_CASH_THRESHOLD.toLocaleString()}`}
              >
                ⚠️ Exceso Liquidez
              </span>
            )}
            {!excesoLiquidez && porcentajeLiquidez >= 70 && (
              <span
                className="status-badge"
                style={{ backgroundColor: '#FCD34D', color: '#92400E' }}
                title={`Alcanzaste el ${porcentajeLiquidez.toFixed(0)}% del límite sugerido`}
              >
                ⚠️ {porcentajeLiquidez.toFixed(0)}% del límite
              </span>
            )}
          </div>

          {/* Metadata (fecha inicio, sync, actividad) */}
          <div className="status-meta">
            <small>
              Inicio: {cajaActual?.fecha_apertura ? new Date(cajaActual.fecha_apertura).toLocaleString() : '...'}
            </small>
            {lastSyncTime && (
              <small>
                Sync: {lastSyncTime.toLocaleTimeString()}
              </small>
            )}
            {lastActivity && (
              <div className="activity-indicator">
                <div className={`activity-dot ${isActive ? 'active' : ''}`} />
                <span>{isActive ? 'Activo ahora' : `Actividad: ${lastActivity.toLocaleTimeString()}`}</span>
              </div>
            )}
          </div>

          {/* Barra de progreso de liquidez */}
          <div className="liquidity-progress">
            <div className="liquidity-header">
              <span>Uso del límite</span>
              <span style={{
                color: porcentajeLiquidez >= 100 ? '#DC2626' : porcentajeLiquidez >= 70 ? '#F59E0B' : '#10B981'
              }}>
                {porcentajeLiquidez.toFixed(1)}% / ${CAJA_CONFIG?.MAX_CASH_THRESHOLD.toLocaleString()}
              </span>
            </div>
            <div className="liquidity-bar">
              <div
                className={`liquidity-fill ${porcentajeLiquidez >= 100 ? 'danger' : porcentajeLiquidez >= 70 ? 'warning' : ''}`}
                style={{ width: `${Math.min(porcentajeLiquidez, 100)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Botones de acción - Grid 2x2 en móvil, 4 en línea en desktop */}
        <div className="status-actions">
          <button
            className="btn"
            onClick={onBackup}
            disabled={isBackupLoading}
            title="Guardar copia de seguridad ahora"
            style={{
              backgroundColor: 'var(--card-background-color)',
              border: '1px solid var(--primary-color)',
              color: 'var(--primary-color)'
            }}
          >
            {isBackupLoading ? (
              <><span className="spinner-small"></span> Respaldo</>
            ) : (
              <><Save size={18} /> Respaldo</>
            )}
          </button>

          <button
            className="btn"
            onClick={onReporte}
            disabled={isBackupLoading || !onReporte}
            title="Descargar reporte del turno en CSV"
            style={{
              backgroundColor: 'var(--success-color)',
              color: 'white',
              border: 'none'
            }}
          >
            📊 Reporte
          </button>

          <button
            className="btn"
            onClick={onResumen}
            disabled={isBackupLoading || !onResumen}
            title="Ver resumen estadístico del turno"
            style={{
              backgroundColor: '#6366F1',
              color: 'white',
              border: 'none'
            }}
          >
            📈 Resumen
          </button>

          <button
            className="btn"
            onClick={onImprimir}
            disabled={isBackupLoading}
            title="Imprimir vista actual"
            style={{
              backgroundColor: '#64748B',
              color: 'white',
              border: 'none'
            }}
          >
            <Printer size={18} /> Imprimir
          </button>
        </div>
      </div>

      <div className="status-body">
        <div className="info-row">
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            Fondo Inicial
            <button
              className="btn-icon-small"
              onClick={onEditarFondoInicial}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-light)',
                padding: '0',
                display: 'flex',
                alignItems: 'center'
              }}
              title="Corregir fondo inicial calculado"
            >
              <Pencil size={16} />
            </button>
          </span>
          <span className="amount neutral">
            ${Money.toNumber(cajaActual?.monto_inicial || 0).toFixed(2)}
          </span>
        </div>

        <div className="info-row">
          <span>Ventas (Efectivo)</span>
          <span className="amount success">
            + ${Money.toNumber(totalesTurno.ventasContado || 0).toFixed(2)}
          </span>
        </div>

        {Money.init(totalesTurno.abonosFiado || 0).gt(0) && (
          <div className="info-row">
            <span>Abonos (Créditos)</span>
            <span className="amount warning">
              + ${Money.toNumber(totalesTurno.abonosFiado || 0).toFixed(2)}
            </span>
          </div>
        )}

        <div className="info-row">
          <span>Entradas Extras</span>
          <span className="amount positive">
            + ${Money.toNumber(cajaActual?.entradas_efectivo || 0).toFixed(2)}
          </span>
        </div>
        <div className="info-row">
          <span>Salidas (Gastos)</span>
          <span className="amount negative">
            - ${Money.toNumber(cajaActual?.salidas_efectivo || 0).toFixed(2)}
          </span>
        </div>

        <div
          className="info-row"
          style={{
            borderTop: '2px solid #eee',
            marginTop: '10px',
            paddingTop: '10px',
            borderBottom: 'none'
          }}
        >
          <span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>Total en Caja</span>
          <span className="amount" style={{ fontSize: '1.4rem', color: 'var(--primary-color)' }}>
            ${Money.toNumber(totalEnCajaSafe).toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  );
};

export default CajaStatusCard;
