import {
  Activity,
  AlertTriangle,
  BarChart3,
  Clock3,
  FileDown,
  Pencil,
  Printer,
  Save,
  ShieldCheck,
  UserRound,
  WalletCards
} from 'lucide-react';
import { Money } from '../../../utils/moneyMath';

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
  isCloudCash = false,
  isReadOnly = false,
  cashActor = null,
  cashMode = null,
  onEditarFondoInicial,
  onBackup,
  onReporte,
  onResumen,
  onImprimir
}) => {
  let totalEnCajaSafe = Money.init(0);
  let entradasTotalesSafe = Money.init(0);

  if (cajaActual) {
    const inicial = Money.init(cajaActual.monto_inicial || 0);
    const ventas = Money.init(totalesTurno.ventasContado || 0);
    const abonos = Money.init(totalesTurno.abonosFiado || 0);
    entradasTotalesSafe = Money.init(cajaActual.entradas_efectivo || 0);
    const salidas = Money.init(cajaActual.salidas_efectivo || 0);

    const subtotalIngresos = Money.add(inicial, ventas);
    const subtotalExtras = Money.add(abonos, entradasTotalesSafe);
    const ingresosTotales = Money.add(subtotalIngresos, subtotalExtras);
    totalEnCajaSafe = Money.subtract(ingresosTotales, salidas);
  }

  const liquidityLevel = porcentajeLiquidez >= 100
    ? 'danger'
    : porcentajeLiquidez >= 70
      ? 'warning'
      : 'safe';
  const maxCashThreshold = CAJA_CONFIG?.MAX_CASH_THRESHOLD || 0;
  const isStaffCash = cajaActual?.deviceRole === 'staff' || cashActor?.isStaff || cajaActual?.staffUserId || cajaActual?.staff_user_id;
  const actorLabel = isStaffCash ? 'Staff' : 'Admin';
  const responsibleName = cajaActual?.responsable_apertura || cajaActual?.responsibleName || cashActor?.responsibleName;
  const actorName = cashActor?.displayName || cashActor?.responsibleName || responsibleName;
  const staffId = cajaActual?.staffUserId || cajaActual?.staff_user_id || cashActor?.staffUserId;
  const isOfflineCloud = Boolean(isCloudCash && (isReadOnly || cashMode?.online === false));

  return (
    <section className="caja-card status-card" aria-labelledby="cash-total-title">
      <div className="status-ribbon">
        <div className="status-ribbon-main">
          <div className="status-badges">
            <span className="status-badge open">
              <span className="status-badge-dot" aria-hidden="true" />
              Turno activo
            </span>
            <span className={`status-badge ${isCloudCash ? 'success' : 'neutral'}`}>
              <ShieldCheck size={14} aria-hidden="true" />
              {isCloudCash ? 'Cloud PRO' : 'Local'}
            </span>
            {isReadOnly && (
              <span className="status-badge warning">
                <ShieldCheck size={14} aria-hidden="true" />
                Solo consulta
              </span>
            )}
            <span className={`status-badge ${isStaffCash ? 'warning' : 'success'}`}>
              <UserRound size={14} aria-hidden="true" />
              {actorLabel}
            </span>
            {excesoLiquidez && (
              <span
                className="status-badge danger"
                title={`Excede el límite sugerido de $${maxCashThreshold.toLocaleString()}`}
              >
                <AlertTriangle size={14} aria-hidden="true" />
                Exceso de liquidez
              </span>
            )}
            {!excesoLiquidez && porcentajeLiquidez >= 70 && (
              <span
                className="status-badge warning"
                title={`Alcanzaste el ${porcentajeLiquidez.toFixed(0)}% del límite sugerido`}
              >
                <AlertTriangle size={14} aria-hidden="true" />
                {porcentajeLiquidez.toFixed(0)}% del límite
              </span>
            )}
          </div>

          <div className="status-meta">
            <span>
              <Clock3 size={14} aria-hidden="true" />
              Inicio: {cajaActual?.fecha_apertura ? new Date(cajaActual.fecha_apertura).toLocaleString() : '...'}
            </span>
            {responsibleName && (
              <span>
                <UserRound size={14} aria-hidden="true" />
                Responsable: {responsibleName}
              </span>
            )}
            {isCloudCash && (
              <span>
                Caja: {isStaffCash ? 'Caja de staff' : 'Caja admin'}{staffId ? ` - staff ${String(staffId).slice(0, 8)}` : ''}
              </span>
            )}
            {actorName && (
              <span>
                Actor actual: {actorName}
              </span>
            )}
            {isOfflineCloud && (
              <span>
                Cloud PRO offline: solo consulta
              </span>
            )}
            {lastSyncTime && (
              <span>
                <Activity size={14} aria-hidden="true" />
                Sync: {lastSyncTime.toLocaleTimeString()}
              </span>
            )}
            {lastActivity && (
              <span className="activity-indicator">
                <span className={`activity-dot ${isActive ? 'active' : ''}`} aria-hidden="true" />
                {isActive ? 'Activo ahora' : `Actividad: ${lastActivity.toLocaleTimeString()}`}
              </span>
            )}
          </div>
        </div>

        <div className="status-utilities" aria-label="Utilidades de caja">
          <button
            className="utility-button utility-button-primary"
            onClick={onBackup}
            disabled={isBackupLoading}
            title="Guardar copia de seguridad ahora"
          >
            {isBackupLoading ? (
              <><span className="spinner-small" aria-hidden="true" /><span>Respaldo</span></>
            ) : (
              <><Save size={17} aria-hidden="true" /><span>Respaldo</span></>
            )}
          </button>
          <button
            className="utility-button"
            onClick={onReporte}
            disabled={isBackupLoading || !onReporte}
            title="Descargar reporte del turno en CSV"
          >
            <FileDown size={17} aria-hidden="true" />
            <span>Reporte</span>
          </button>
          <button
            className="utility-button"
            onClick={onResumen}
            disabled={isBackupLoading || !onResumen}
            title="Ver resumen estadístico del turno"
          >
            <BarChart3 size={17} aria-hidden="true" />
            <span>Resumen</span>
          </button>
          <button
            className="utility-button"
            onClick={onImprimir}
            disabled={isBackupLoading}
            title="Imprimir vista actual"
          >
            <Printer size={17} aria-hidden="true" />
            <span>Imprimir</span>
          </button>
        </div>
      </div>

      <div className="cash-hero">
        <div className="cash-hero-heading">
          <span className="cash-hero-icon" aria-hidden="true">
            <WalletCards size={22} />
          </span>
          <div>
            <p className="cash-hero-eyebrow">Disponible en el turno</p>
            <h2 id="cash-total-title">Total en Caja</h2>
          </div>
        </div>

        <strong className="cash-hero-amount">
          ${Money.toNumber(totalEnCajaSafe).toFixed(2)}
        </strong>

        <div className="liquidity-progress">
          <div className="liquidity-header">
            <span>Liquidez acumulada</span>
            <strong className={`liquidity-value ${liquidityLevel}`}>
              {porcentajeLiquidez.toFixed(1)}%
            </strong>
          </div>
          <div
            className="liquidity-bar"
            role="progressbar"
            aria-label="Porcentaje del límite de efectivo"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={Math.min(Math.round(porcentajeLiquidez), 100)}
          >
            <div
              className={`liquidity-fill ${liquidityLevel}`}
              style={{ '--liquidity-width': `${Math.min(porcentajeLiquidez, 100)}%` }}
            />
          </div>
          <p className="liquidity-limit">
            Límite sugerido: ${maxCashThreshold.toLocaleString()}
          </p>
        </div>
      </div>

      <div className="cash-breakdown" aria-label="Desglose del efectivo">
        <div className="cash-metric">
          <div className="cash-metric-label">
            <span>Fondo inicial</span>
            <button
              className="btn-icon-small"
              onClick={onEditarFondoInicial}
              title="Corregir fondo inicial calculado"
              aria-label="Editar fondo inicial"
              disabled={isReadOnly || isBackupLoading}
            >
              <Pencil size={15} aria-hidden="true" />
            </button>
          </div>
          <strong className="amount neutral">
            ${Money.toNumber(cajaActual?.monto_inicial || 0).toFixed(2)}
          </strong>
        </div>

        <div className="cash-metric">
          <span className="cash-metric-label">Ventas en efectivo</span>
          <strong className="amount positive">
            + ${Money.toNumber(totalesTurno.ventasContado || 0).toFixed(2)}
          </strong>
        </div>

        {Money.init(totalesTurno.abonosFiado || 0).gt(0) && (
          <div className="cash-metric">
            <span className="cash-metric-label">Abonos</span>
            <strong className="amount warning">
              + ${Money.toNumber(totalesTurno.abonosFiado || 0).toFixed(2)}
            </strong>
          </div>
        )}

        <div className="cash-metric">
          <span className="cash-metric-label">Entradas</span>
          <strong className="amount positive">
            + ${Money.toNumber(entradasTotalesSafe).toFixed(2)}
          </strong>
        </div>

        <div className="cash-metric">
          <span className="cash-metric-label">Salidas</span>
          <strong className="amount negative">
            - ${Money.toNumber(cajaActual?.salidas_efectivo || 0).toFixed(2)}
          </strong>
        </div>
      </div>
    </section>
  );
};

export default CajaStatusCard;
