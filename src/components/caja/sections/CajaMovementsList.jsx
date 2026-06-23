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

const CajaMovementsList = ({ movimientos, initialFilterType = 'todos' }) => {
  const [filtroTipo, setFiltroTipo] = useState(initialFilterType);
  const [busqueda, setBusqueda] = useState('');

  const movimientosRender = useMemo(() => {
    let filtrados = movimientos;

    if (filtroTipo !== 'todos') {
      if (filtroTipo === 'entrada') {
        filtrados = filtrados.filter(m =>
          ['entrada', 'ajuste_entrada', 'venta', 'abono', 'venta_tarjeta'].includes(m.tipo)
        );
      } else if (filtroTipo === 'salida') {
        filtrados = filtrados.filter(m =>
          ['salida', 'ajuste_salida', 'venta_eliminada', 'merma'].includes(m.tipo)
        );
      } else if (filtroTipo === 'ajuste') {
        filtrados = filtrados.filter(m =>
          m.tipo === 'ajuste_entrada' ||
          m.tipo === 'ajuste_salida' ||
          m.tipo === 'fondo_inicial_ajuste'
        );
      }
    }

    if (busqueda.trim()) {
      const busquedaLower = busqueda.toLowerCase().trim();
      filtrados = filtrados.filter(m =>
        m.concepto.toLowerCase().includes(busquedaLower)
      );
    }

    return filtrados.map(mov => {
      const esEntrada = ['entrada', 'ajuste_entrada', 'venta', 'abono'].includes(mov.tipo);
      const esSalida = ['salida', 'ajuste_salida'].includes(mov.tipo);
      const esAjuste = ['ajuste_entrada', 'ajuste_salida'].includes(mov.tipo);
      const esAjusteFondoInicial = mov.tipo === 'fondo_inicial_ajuste';
      const esVentaTarjeta = mov.tipo === 'venta_tarjeta';
      const esEliminacion = ['venta_eliminada', 'merma'].includes(mov.tipo);
      const deltaSafe = esAjusteFondoInicial ? Money.init(mov.audit?.delta || 0) : Money.init(0);

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
      else if (mov.tipo === 'venta') badge = 'Venta';
      else if (mov.tipo === 'abono') badge = 'Abono';

      return {
        id: mov.id,
        concepto: esAjuste || esAjusteFondoInicial ? `[Ajuste] ${mov.concepto}` : mov.concepto,
        monto: `${prefijo}$${Money.toNumber(mov.monto).toFixed(2)}`,
        hora: new Date(mov.fecha).toLocaleTimeString(),
        actor: mov.actor || mov.audit?.actor || null,
        badge,
        tone
      };
    });
  }, [movimientos, filtroTipo, busqueda]);

  const handleLimpiarFiltros = () => {
    setFiltroTipo('todos');
    setBusqueda('');
  };

  const hayFiltrosActivos = filtroTipo !== 'todos' || busqueda;

  return (
    <section id="caja-movements-container" className="caja-card" aria-labelledby="movements-title">
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
        <span className="items-count">
          {movimientosRender.length} de {movimientos.length}
        </span>
      </div>

      <div className="filters-bar">
        <label className="filter-control">
          <ListFilter size={17} aria-hidden="true" />
          <select
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value)}
            className="filter-select"
            aria-label="Filtrar por tipo de movimiento"
          >
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
          <button onClick={handleLimpiarFiltros} className="btn-clear-filters">
            <SlidersHorizontal size={16} aria-hidden="true" />
            Limpiar
          </button>
        )}
      </div>

      <div id="caja-movements-list" className="movements-list">
        {movimientosRender.length === 0 ? (
          <div className="empty-state">
            <ReceiptText className="empty-state-icon" size={30} aria-hidden="true" />
            <p>
              {movimientos.length === 0
                ? 'No hay movimientos registrados.'
                : 'No se encontraron movimientos con los filtros actuales.'}
            </p>
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
                  {mov.actor && <small>Responsable: {mov.actor}</small>}
                  {mov.badge && <span className="movement-badge">{mov.badge}</span>}
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
