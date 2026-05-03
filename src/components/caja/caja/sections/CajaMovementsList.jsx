// src/components/caja/sections/CajaMovementsList.jsx
import { useState, useMemo } from 'react';
import { Money } from '../../../utils/moneyMath';

/**
 * Lista de movimientos del turno con filtros y búsqueda encapsulada
 *
 * @param {Object} props
 * @param {Array} props.movimientos - Array de movimientos de caja
 * @param {string} props.initialFilterType - Tipo de filtro inicial ('todos', 'entrada', 'salida', 'ajuste')
 */
const CajaMovementsList = ({ movimientos, initialFilterType = 'todos' }) => {
  // Estados locales de UI - NO contaminan el orquestador global
  const [filtroTipo, setFiltroTipo] = useState(initialFilterType);
  const [busqueda, setBusqueda] = useState('');

  // Memoización de movimientos filtrados
  const movimientosRender = useMemo(() => {
    let filtrados = movimientos;

    // Filtro por tipo
    if (filtroTipo !== 'todos') {
      if (filtroTipo === 'entrada') {
        filtrados = filtrados.filter(m =>
          m.tipo === 'entrada' || m.tipo === 'ajuste_entrada'
        );
      } else if (filtroTipo === 'salida') {
        filtrados = filtrados.filter(m =>
          m.tipo === 'salida' || m.tipo === 'ajuste_salida'
        );
      } else if (filtroTipo === 'ajuste') {
        filtrados = filtrados.filter(m =>
          m.tipo === 'ajuste_entrada' || m.tipo === 'ajuste_salida'
        );
      }
    }

    // Búsqueda por concepto
    if (busqueda.trim()) {
      const busquedaLower = busqueda.toLowerCase().trim();
      filtrados = filtrados.filter(m =>
        m.concepto.toLowerCase().includes(busquedaLower)
      );
    }

    // Transformar para render
    return filtrados.map(mov => {
      const esEntrada = mov.tipo === 'entrada' || mov.tipo === 'ajuste_entrada';
      const esAjuste = mov.tipo === 'ajuste_entrada' || mov.tipo === 'ajuste_salida';
      const colorMov = esEntrada ? 'var(--success-color)' : 'var(--error-color)';
      const montoFormatted = Money.toNumber(mov.monto).toFixed(2);
      const horaFormatted = new Date(mov.fecha).toLocaleTimeString();

      return {
        id: mov.id,
        esEntrada,
        esAjuste,
        colorMov,
        concepto: esAjuste ? `[Ajuste] ${mov.concepto}` : mov.concepto,
        monto: `${esEntrada ? '+' : '-'}$${montoFormatted}`,
        hora: horaFormatted,
        tipo: mov.tipo
      };
    });
  }, [movimientos, filtroTipo, busqueda]);

  const handleLimpiarFiltros = () => {
    setFiltroTipo('todos');
    setBusqueda('');
  };

  const hayFiltrosActivos = filtroTipo !== 'todos' || busqueda;

  return (
    <div id="caja-movements-container" className="caja-card">
      <div className="section-header">
        <h3 className="section-title">Movimientos del Turno</h3>
        <span className="items-count">
          {movimientosRender.length} de {movimientos.length}
        </span>
      </div>

      {/* Filtros y Búsqueda */}
      <div className="filters-bar">
        {/* Filtro por tipo */}
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

        {/* Búsqueda */}
        <input
          type="text"
          placeholder="Buscar por concepto..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="search-input"
          aria-label="Buscar movimientos por concepto"
        />

        {/* Botón limpiar filtros */}
        {hayFiltrosActivos && (
          <button
            onClick={handleLimpiarFiltros}
            className="btn-clear-filters"
          >
            Limpiar
          </button>
        )}
      </div>

      <div id="caja-movements-list" className="movements-list">
        {movimientosRender.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📋</div>
            <p>
              {movimientos.length === 0
                ? 'No hay movimientos registrados.'
                : 'No se encontraron movimientos con los filtros actuales.'}
            </p>
          </div>
        ) : (
          movimientosRender.map(mov => (
            <div
              key={mov.id}
              className="movement-item"
              style={{ borderLeftColor: mov.colorMov }}
            >
              <div className="movement-header">
                <span className="movement-title">{mov.concepto}</span>
                <span className="movement-amount" style={{ color: mov.colorMov }}>
                  {mov.monto}
                </span>
              </div>
              <div className="movement-details">
                <small>{mov.hora}</small>
                {mov.esAjuste && (
                  <span className="status-badge">Ajuste</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default CajaMovementsList;
