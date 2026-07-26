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
import { resolveCashSessionAmounts } from '../../../services/cajaProjection';
import { hasHistoricalIntegrityWarning } from '../../../services/layawayFinancialProjection';

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
  onEditarFondoInicial,
  onBackup,
  onReporte,
  onResumen,
  onImprimir
}) => {
  const cashAmounts = cajaActual
    ? resolveCashSessionAmounts(cajaActual, totalesTurno, { isCloudCash })
    : null;

  // En cloud, Supabase es la fuente oficial de totales de caja.
  const totalEnCajaSafe = Money.init(cashAmounts?.totalTeorico || 0);
  const entradasTotalesSafe = Money.init(cashAmounts?.entradasEfectivo || 0);
  const ventasTurnoSafe = Money.init(cashAmounts?.ventasContado || 0);
  const abonosTurnoSafe = Money.init(cashAmounts?.abonosFiado || 0);
  const salidasTotalesSafe = Money.init(cashAmounts?.salidasEfectivo || 0);
  const reconciliation = cashAmounts?.reconciliation || null;
  const unlinkedTechnicalPaymentsCount = Number(reconciliation?.unlinkedTechnicalPayments?.length || 0);
  const missingCashMovementRecords = reconciliation?.paymentsWithMissingCashMovementRecord || [];
  const missingCashMovementRecordsAmount = missingCashMovementRecords.reduce(
    (total, item) => Money.add(total, item.amount || 0),
    Money.init(0)
  );
  const invalidCashMovementLinks = reconciliation?.paymentsWithInvalidCashMovementLink || [];

  const liquidityLevel = porcentajeLiquidez >= 100
    ? 'danger'
    : porcentajeLiquidez >= 70
      ? 'warning'
      : 'safe';
  const maxCashThreshold = CAJA_CONFIG?.MAX_CASH_THRESHOLD || 0;
  const responsibleName = cajaActual?.responsable_apertura
    || cajaActual?.responsibleName
    || cashActor?.responsibleName
    || cashActor?.displayName;

  return (
    <section className="ui-card ui-card--compact caja-card status-card" aria-labelledby="cash-total-title">
      <div className="status-ribbon">
        <div className="status-ribbon-main">
          <div className="status-badges">
            <span className="ui-badge ui-badge--success status-badge open">
              <span className="status-badge-dot" aria-hidden="true" />
              Turno activo
            </span>
            {isReadOnly && (
              <span className="ui-badge ui-badge--warning status-badge warning">
                <ShieldCheck size={14} aria-hidden="true" />
                Solo consulta
              </span>
            )}
            {excesoLiquidez && (
              <span
                className="ui-badge ui-badge--danger status-badge danger"
                title={`Excede el límite sugerido de $${maxCashThreshold.toLocaleString()}`}
              >
                <AlertTriangle size={14} aria-hidden="true" />
                Exceso de liquidez
              </span>
            )}
            {!excesoLiquidez && porcentajeLiquidez >= 70 && (
              <span
                className="ui-badge ui-badge--warning status-badge warning"
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
          <button type="button"
            className="ui-button ui-button--primary utility-button utility-button-primary"
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
          <button type="button"
            className="ui-button ui-button--neutral utility-button"
            onClick={onReporte}
            disabled={isBackupLoading || !onReporte}
            title="Descargar reporte del turno en CSV"
          >
            <FileDown size={17} aria-hidden="true" />
            <span>Reporte</span>
          </button>
          <button type="button"
            className="ui-button ui-button--neutral utility-button"
            onClick={onResumen}
            disabled={isBackupLoading || !onResumen}
            title="Ver resumen estadístico del turno"
          >
            <BarChart3 size={17} aria-hidden="true" />
            <span>Resumen</span>
          </button>
          <button type="button"
            className="ui-button ui-button--neutral utility-button"
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
            <button type="button"
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
            ${Money.toNumber(cashAmounts?.fondoInicial || 0).toFixed(2)}
          </strong>
        </div>

        <div className="cash-metric">
          <span className="cash-metric-label">Ventas en efectivo</span>
          <strong className="amount positive">
            + ${Money.toNumber(ventasTurnoSafe).toFixed(2)}
          </strong>
        </div>

        {abonosTurnoSafe.gt(0) && (
          <div className="cash-metric">
            <span className="cash-metric-label">Abonos</span>
            <strong className="amount warning">
              + ${Money.toNumber(abonosTurnoSafe).toFixed(2)}
            </strong>
          </div>
        )}

        {reconciliation ? (
          <>
            <div className="cash-metric">
              <span className="cash-metric-label">Cobros de apartados respaldados por Caja</span>
              <strong className="amount warning">+ ${Money.toNumber(reconciliation.layawayCashCollected ?? reconciliation.layawayPaymentsCollected).toFixed(2)}</strong>
            </div>
            <div className="cash-metric">
              <span className="cash-metric-label">Cobros de clientes / fiado</span>
              <strong className="amount positive">+ ${Money.toNumber(reconciliation.customerCreditCollections).toFixed(2)}</strong>
            </div>
            <div className="cash-metric">
              <span className="cash-metric-label">Entradas manuales y ajustes</span>
              <strong className="amount positive">+ ${Money.toNumber(Money.add(reconciliation.manualEntries, reconciliation.positiveAdjustments)).toFixed(2)}</strong>
            </div>
          </>
        ) : (
          <div className="cash-metric">
            <span className="cash-metric-label">Entradas</span>
            <strong className="amount positive">+ ${Money.toNumber(entradasTotalesSafe).toFixed(2)}</strong>
          </div>
        )}

        <div className="cash-metric">
          <span className="cash-metric-label">Salidas</span>
          <strong className="amount negative">
            - ${Money.toNumber(salidasTotalesSafe).toFixed(2)}
          </strong>
        </div>
      </div>

      {reconciliation && (
        <div className="cash-breakdown" aria-label="Conciliación de ingresos">
          <p className="cash-hero-eyebrow" style={{ gridColumn: '1 / -1', margin: 0 }}>Conciliación de ingresos</p>
          <div className="cash-metric"><span className="cash-metric-label">Ventas reconocidas</span><strong className="amount positive">${Money.toNumber(reconciliation.recognizedSales).toFixed(2)}</strong></div>
          <div className="cash-metric"><span className="cash-metric-label">Apartados entregados</span><strong className="amount positive">${Money.toNumber(reconciliation.layawayCompletedRevenue).toFixed(2)}</strong></div>
          <div className="cash-metric"><span className="cash-metric-label">Anticipos pendientes</span><strong className="amount warning">${Money.toNumber(reconciliation.layawayPendingAdvances).toFixed(2)}</strong></div>
          <div className="cash-metric"><span className="cash-metric-label">Ganancia bruta reconocida (apartados)</span><strong className="amount positive">${Money.toNumber(reconciliation.layawayCompletedGrossProfit).toFixed(2)}</strong></div>
          <div className="cash-metric"><span className="cash-metric-label">Diferencia sin clasificar</span><strong className="amount neutral">${Money.toNumber(reconciliation.unclassifiedDifference).toFixed(2)}</strong></div>
          {hasHistoricalIntegrityWarning(reconciliation) && (
            <div className="cash-metric" style={{ gridColumn: '1 / -1' }} role="status">
              <span className="cash-metric-label">Advertencia de integridad histórica</span>
              {unlinkedTechnicalPaymentsCount > 0 && (
                <span className="cash-metric-label">Pagos sin vínculo técnico: {unlinkedTechnicalPaymentsCount} por ${Money.toNumber(reconciliation.unlinkedTechnicalPaymentsAmount).toFixed(2)}</span>
              )}
              {missingCashMovementRecords.length > 0 && (
                <span className="cash-metric-label">Pagos con movimiento de Caja no localizado: {missingCashMovementRecords.length} por ${Money.toNumber(missingCashMovementRecordsAmount).toFixed(2)}</span>
              )}
              {invalidCashMovementLinks.length > 0 && (
                <span className="cash-metric-label">Pagos con vínculo de Caja inválido: {invalidCashMovementLinks.length} por ${Money.toNumber(reconciliation.paymentsWithInvalidCashMovementLinkAmount).toFixed(2)}</span>
              )}
              {Number(reconciliation.probableLegacyCashBackingAmount || 0) > 0 && (
                <span className="cash-metric-label">Probable respaldo en movimientos históricos: ${Money.toNumber(reconciliation.probableLegacyCashBackingAmount).toFixed(2)}</span>
              )}
              {Number(reconciliation.unverifiedHistoricalPaymentsAmount || 0) > 0 && (
                <strong className="amount warning">Monto sin respaldo verificable: ${Money.toNumber(reconciliation.unverifiedHistoricalPaymentsAmount).toFixed(2)}</strong>
              )}
              <span className="cash-metric-label">Los movimientos históricos no fueron modificados ni vinculados automáticamente.</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default CajaStatusCard;
