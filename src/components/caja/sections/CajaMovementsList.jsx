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

const CajaMovementsList = ({ movimientos, initialFilterType = 'todos', isCloudCash = false }) => {
  const [filtroTipo, setFiltroTipo] = useState(initialFilterType);
  const [busqueda, setBusqueda] = useState('');

  const movimientosRender = useMemo(() => {
    let filtrados = movimientos;

    if (filtroTipo !== 'todos') {
      if (filtroTipo === 'entrada') {
        filtrados = filtrados.filter(m => ['entrada', 'ajuste_entrada', 'venta', 'abono', 'venta_tarjeta', 'venta_efectivo', 'abono_cliente'].includes(m.tipo));
      } else if (filtroTipo === 'salida') {
        filtrados = filtrados.filter(m => ['salida', 'ajuste_salida', 'venta_eliminada', 'merma', 'cancelacion'].includes(m.tipo));
      } else if (filtroTipo === 'ajuste') {
        filtrados = filtrados.filter(m => ['ajuste_entrada', 'ajuste_salida', 'fondo_inicial_ajuste'].includes(m.tipo));
      }
    }

    if (busqueda.trim()) {
      const busquedaLower = busqueda.toLowerCase().trim();
      filtrados = filtrados.filter(m => String(m.concepto || '').toLowerCase().includes(busquedaLower));
    }

    return filtrados.map(mov => {
      const esEntrada = ['entrada', 'ajuste_entrada', 'venta', 'abono', 'venta_efectivo', 'abono_cliente'].includes(mov.tipo);
      const esSalida = ['salida', 'ajuste_salida'].includes(mov.tipo);
      const esAjuste = ['ajuste_entrada', 'ajuste_salida'].includes(mov.tipo);
      const esAjusteFondoInicial = mov.tipo === 'fondo_inicial_ajuste';
      const esVentaTarjeta = mov.tipo === 'venta_tarjeta';
      const esEliminacion = ['venta_eliminada', 'merma', 'cancelacion'].includes(mov.tipo);
      const deltaSafe = esAjusteFondoInicial ? Money.init(mov.audit?.delta || mov.metadata?.delta || 0) : Money.init(0);

      let prefijo = '';
      let tone = 'neutral';
      if (esEntrada) { tone = 'positive'; prefijo = '+'; }
      else if (esSalida) { tone = 'negative'; prefijo = '-'; }
      else if (esAjusteFondoInicial) {
        tone = deltaSafe.gt(0) ? 'positive' : deltaSafe.lt(0) ? 'negative' : 'neutral';
        prefijo = deltaSafe.gt(0) ? '+' : deltaSafe.lt(0) ? '-' : '';
      }
      else if (esEliminacion) { tone = 'warning'; prefijo = '-'; }
      else if (esVentaTarjeta) { tone = 'card'; prefijo = '+'; }

      let badge = '';
      if (esAjuste) badge = 'Ajuste';
      else if (esAjusteFondoInicial) badge = 'Fondo inicial';
      else if (esVentaTarjeta) badge = 'Tarjeta/Transf.';
      else if (mov.tipo === 'venta_eliminada') badge = 'Venta eliminada';
      else if (mov.tipo === 'merma') badge = 'Merma';
      else if (mov.tipo === 'venta' || mov.tipo === 'venta_efectivo') badge = 'Venta';
      else if (mov.tipo === 'abono' || mov.tipo === 'abono_cliente') badge = 'Abono';
      else if (mov.tipo === 'cancelacion') badge = 'Cancelación';
      else if (mov.tipo === 'entrada') badge = 'Entrada';
      else if (mov.tipo === 'salida') badge = 'Salida';

      return {
        id: mov.id,
        concepto: esAjuste || esAjusteFondoInicial ? `[Ajuste] ${mov.concepto}` : mov.concepto,
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
            <option value="entrada">Entradas</option>
            <option value="salida">Salidas</option>
            <option value="ajuste">Ajustes</option>
          </select>
        </label>

        <label className="search-control">
          <Search size={17} aria-hidden="true" />
          <input
            type="text"
            placeholder="Buscar por concepto..."
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
                  <small>{mov.hora}</small>
                  {mov.actor && <small>Actor: {mov.actor}</small>}
                  {mov.staff && <small>Staff: {mov.staff}</small>}
                  {mov.actorKey && <small>Actor key: {mov.actorKey}</small>}
                  {mov.origen && <small>Origen: {mov.origen}</small>}
                  {mov.badge && <span className="ui-badge ui-badge--neutral ui-badge--sm movement-badge">{mov.badge}</span>}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
};

export default CajaMovementsList;
