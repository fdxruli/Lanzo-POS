import { useState, useMemo } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CircleDollarSign,
  ListFilter,
  ReceiptText,
  Search,
  SlidersHorizontal,
  WalletCards
} from 'lucide-react';
import { Money } from '../../../utils/moneyMath';
import {
  getSaleDisplayReference,
  getSaleSecondaryReference,
  normalizeSaleTraceability,
  saleMatchesReference
} from '../../../services/sales/saleReference';

const CASH_INFLOW_TYPES = new Set([
  'entrada', 'ajuste_entrada', 'venta', 'venta_efectivo', 'abono', 'abono_cliente'
]);
const CASH_OUTFLOW_TYPES = new Set([
  'salida', 'ajuste_salida', 'cancelacion', 'cancelacion_venta', 'cancelacion_abono_inicial'
]);
const CASH_ADJUSTMENT_TYPES = new Set([
  'ajuste_entrada', 'ajuste_salida', 'fondo_inicial_ajuste'
]);
const NO_CASH_EFFECT_TYPES = new Set(['venta_tarjeta', 'venta_eliminada', 'merma']);

const getMovementType = (movement = {}) => String(movement.tipo || movement.type || '').toLowerCase();

const CajaMovementsList = ({ movimientos, initialFilterType = 'todos', isCloudCash = false }) => {
  const [filtroTipo, setFiltroTipo] = useState(initialFilterType);
  const [busqueda, setBusqueda] = useState('');

  const movimientosRender = useMemo(() => {
    let filtrados = movimientos;

    if (filtroTipo !== 'todos') {
      if (filtroTipo === 'entrada') {
        filtrados = filtrados.filter(m => CASH_INFLOW_TYPES.has(getMovementType(m)));
      } else if (filtroTipo === 'salida') {
        filtrados = filtrados.filter(m => CASH_OUTFLOW_TYPES.has(getMovementType(m)));
      } else if (filtroTipo === 'ajuste') {
        filtrados = filtrados.filter(m => CASH_ADJUSTMENT_TYPES.has(getMovementType(m)));
      } else if (filtroTipo === 'sin_efecto_efectivo') {
        filtrados = filtrados.filter(m => NO_CASH_EFFECT_TYPES.has(getMovementType(m)));
      }
    }

    if (busqueda.trim()) {
      const busquedaLower = busqueda.toLowerCase().trim();
      filtrados = filtrados.filter(m => (
        String(m.concepto || '').toLowerCase().includes(busquedaLower)
        || saleMatchesReference(m.sale || m.metadata || m, busquedaLower)
      ));
    }

    return filtrados.map(mov => {
      const tipo = getMovementType(mov);
      const esEntrada = CASH_INFLOW_TYPES.has(tipo);
      const esSalida = CASH_OUTFLOW_TYPES.has(tipo);
      const esAjuste = ['ajuste_entrada', 'ajuste_salida'].includes(tipo);
      const esAjusteFondoInicial = tipo === 'fondo_inicial_ajuste';
      const esVentaTarjeta = tipo === 'venta_tarjeta';
      const esCancelacionVenta = tipo === 'cancelacion_venta';
      const esCancelacionAbono = tipo === 'cancelacion_abono_inicial';
      const esCancelacionLegacy = tipo === 'cancelacion';
      const esVentaEliminada = tipo === 'venta_eliminada';
      const esMerma = tipo === 'merma';
      const deltaSafe = esAjusteFondoInicial ? Money.init(mov.audit?.delta || mov.metadata?.delta || 0) : Money.init(0);

      let prefijo = '';
      let tone = 'neutral';
      if (esEntrada) { tone = 'positive'; prefijo = '+'; }
      else if (esSalida) { tone = 'negative'; prefijo = '-'; }
      else if (esAjusteFondoInicial) {
        tone = deltaSafe.gt(0) ? 'positive' : deltaSafe.lt(0) ? 'negative' : 'neutral';
        prefijo = deltaSafe.gt(0) ? '+' : deltaSafe.lt(0) ? '-' : '';
      }
      else if (esVentaTarjeta) { tone = 'card'; }

      let badge = '';
      if (esAjuste) badge = 'Ajuste';
      else if (esAjusteFondoInicial) badge = 'Fondo inicial';
      else if (esVentaTarjeta) badge = 'Tarjeta/Transf.';
      else if (esCancelacionVenta) badge = 'Devolución en efectivo';
      else if (esCancelacionAbono) badge = 'Devolución de abono';
      else if (esCancelacionLegacy) badge = 'Devolución';
      else if (esVentaEliminada) badge = 'Venta eliminada';
      else if (esMerma) badge = 'Merma';
      else if (tipo === 'venta' || tipo === 'venta_efectivo') badge = 'Venta';
      else if (tipo === 'abono' || tipo === 'abono_cliente') badge = 'Abono en efectivo';
      else if (tipo === 'entrada') badge = 'Entrada';
      else if (tipo === 'salida') badge = 'Salida';

      const referenceSource = mov.sale || {
        ...mov,
        ...(mov.metadata || {})
      };
      const traceability = normalizeSaleTraceability(referenceSource);
      const isSaleMovement = ['venta', 'venta_efectivo', 'venta_tarjeta'].includes(tipo);
      const primaryReference = isSaleMovement
        ? getSaleDisplayReference(referenceSource) || mov.concepto
        : mov.concepto;
      const secondaryReference = mov.secondaryReference
        || (isSaleMovement ? getSaleSecondaryReference(referenceSource) : null);

      return {
        id: mov.id,
        concepto: esAjuste || esAjusteFondoInicial ? `[Ajuste] ${mov.concepto}` : primaryReference,
        secondaryReference,
        salesChannel: traceability.salesChannel,
        monto: `${prefijo}$${Money.toNumber(mov.monto).toFixed(2)}`,
        hora: mov.fecha ? new Date(mov.fecha).toLocaleTimeString() : '',
        actor: mov.actor || mov.actorName || mov.audit?.actor || null,
        origen: mov.origen || mov.source || mov.metadata?.source || (mov.cloudCash || isCloudCash ? 'cloud' : 'local'),
        staff: mov.staffUserId || mov.staff_user_id ? String(mov.staffUserId || mov.staff_user_id).slice(0, 8) : null,
        actorKey: mov.actorKey || mov.actor_key || null,
        badge,
        tone
      };
    });
  }, [movimientos, filtroTipo, busqueda, isCloudCash]);

  const handleLimpiarFiltros = () => {
    setFiltroTipo('todos');
    setBusqueda('');
  };

  const hayFiltrosActivos = filtroTipo !== 'todos' || busqueda;

  return (
    <section id="caja-movements-container" className="ui-card ui-card--compact caja-card" aria-labelledby="movements-title">
      <div className="section-header">
        <div className="section-heading">
          <span className="section-heading-icon" aria-hidden="true">
            <ReceiptText size={19} />
          </span>
          <div>
            <p className="section-eyebrow">Actividad reciente</p>
            <h3 id="movements-title" className="section-title">Movimientos del turno</h3>
          </div>
        </div>
        <span className="ui-badge ui-badge--neutral items-count">{movimientosRender.length} de {movimientos.length}</span>
      </div>

      <div className="filters-bar">
        <label className="filter-control">
          <ListFilter size={17} aria-hidden="true" />
          <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} className="filter-select" aria-label="Filtrar por tipo de movimiento">
            <option value="todos">Todos</option>
            <option value="entrada">Entradas de efectivo</option>
            <option value="salida">Salidas de efectivo</option>
            <option value="ajuste">Ajustes</option>
            <option value="sin_efecto_efectivo">Sin movimiento de efectivo</option>
          </select>
        </label>

        <label className="search-control">
          <Search size={17} aria-hidden="true" />
          <input
            type="text"
            placeholder="Buscar por V-, EC-, cliente o método..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="search-input"
            aria-label="Buscar movimientos por concepto"
          />
        </label>

        {hayFiltrosActivos && (
          <button type="button" onClick={handleLimpiarFiltros} className="ui-button ui-button--ghost ui-button--sm btn-clear-filters">
            <SlidersHorizontal size={16} aria-hidden="true" />
            Limpiar
          </button>
        )}
      </div>

      <div id="caja-movements-list" className="movements-list">
        {movimientosRender.length === 0 ? (
          <div className="ui-empty-state empty-state">
            <ReceiptText className="empty-state-icon" size={30} aria-hidden="true" />
            <p>{movimientos.length === 0 ? 'No hay movimientos registrados.' : 'No se encontraron movimientos con los filtros actuales.'}</p>
          </div>
        ) : (
          movimientosRender.map(mov => (
            <div key={mov.id} className={`movement-item movement-${mov.tone}`}>
              <span className="movement-icon" aria-hidden="true">
                {mov.tone === 'negative' || mov.tone === 'warning' ? (
                  <ArrowUpRight size={18} />
                ) : mov.tone === 'card' ? (
                  <WalletCards size={18} />
                ) : mov.tone === 'positive' ? (
                  <ArrowDownLeft size={18} />
                ) : (
                  <CircleDollarSign size={18} />
                )}
              </span>
              <div className="movement-header">
                <span className="movement-title">{mov.concepto}</span>
                <span className="movement-amount">{mov.monto}</span>
                <div className="movement-details">
                  {mov.secondaryReference && <small className="movement-reference-secondary">{mov.secondaryReference}</small>}
                  <small>{mov.hora}</small>
                  {mov.actor && <small>Responsable: {mov.actor}</small>}
                  {mov.badge && <span className="ui-badge ui-badge--neutral ui-badge--sm movement-badge">{mov.badge}</span>}
                  {mov.salesChannel === 'ecommerce' && <span className="ui-badge ui-badge--info ui-badge--sm movement-badge">Ecommerce</span>}
                </div>
                {(mov.staff || mov.actorKey || mov.origen) && (
                  <details className="movement-technical-details">
                    <summary>Detalles</summary>
                    <div className="movement-technical-meta">
                      {mov.staff && <small>Staff ID: {mov.staff}</small>}
                      {mov.actorKey && <small>Actor key: {mov.actorKey}</small>}
                      {mov.origen && <small>Origen: {mov.origen}</small>}
                     </div>
                  </details>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
};

export default CajaMovementsList;
