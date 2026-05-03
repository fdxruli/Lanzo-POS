// src/components/caja/sections/CajaHistoryList.jsx
import { useState, useMemo } from 'react';
import { Money } from '../../../utils/moneyMath';

/**
 * Historial de cortes con paginación encapsulada
 *
 * @param {Object} props
 * @param {Array} props.historial - Array de historial de cajas
 * @param {number} props.itemsPerPage - Cantidad de items por página (default: 10)
 */
const CajaHistoryList = ({ historial, itemsPerPage = 10 }) => {
  // Estado local de paginación - NO contamina el orquestador global
  const [paginaActual, setPaginaActual] = useState(1);

  // Memoización del historial paginado
  const historialRender = useMemo(() => {
    const startIndex = (paginaActual - 1) * itemsPerPage;
    const historialPaginado = historial.slice(startIndex, startIndex + itemsPerPage);

    return historialPaginado.map(c => {
      const diffSafe = Money.init(c.diferencia || 0);
      const isCuadrada = diffSafe.abs().lt(1);
      const fechaFormatted = new Date(c.fecha_apertura).toLocaleDateString();
      const cierreFormatted = c.monto_cierre ? `$${Money.toNumber(c.monto_cierre || 0).toFixed(2)}` : 'N/A';
      const difFormatted = diffSafe.gt(0) ? '+' : '';

      return {
        id: c.id,
        fecha: fechaFormatted,
        isCuadrada,
        cierre: cierreFormatted,
        dif: `${difFormatted}$${Money.toNumber(diffSafe).toFixed(2)}`,
        difColor: diffSafe.gt(0) ? 'var(--success-color)' : 'var(--error-color)'
      };
    });
  }, [historial, paginaActual, itemsPerPage]);

  // Calcular total de páginas
  const totalPaginas = Math.ceil(historial.length / itemsPerPage);

  const handlePaginaAnterior = () => {
    setPaginaActual(p => Math.max(1, p - 1));
  };

  const handlePaginaSiguiente = () => {
    setPaginaActual(p => Math.min(totalPaginas, p + 1));
  };

  if (historial.length === 0) {
    return (
      <div id="caja-history-container" className="caja-card">
        <h3 className="section-title">Historial de Cortes</h3>
        <div className="empty-state">
          <div className="empty-state-icon">📦</div>
          <p>No hay historial de cortes registrados.</p>
        </div>
      </div>
    );
  }

  return (
    <div id="caja-history-container" className="caja-card">
      <h3 className="section-title">Historial de Cortes</h3>

      <div className="history-list">
        {historialRender.map(c => (
          <div key={c.id} className="history-item">
            <div className="movement-header">
              <strong className="movement-title">{c.fecha}</strong>
              <span className={`status-badge ${c.isCuadrada ? 'success' : 'error'}`}>
                {c.isCuadrada ? 'Cuadrada' : 'Descuadre'}
              </span>
            </div>
            <div className="movement-details">
              <span>Cierre: {c.cierre}</span>
              {!c.isCuadrada && (
                <span style={{ color: c.difColor }}>Dif: {c.dif}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Paginación */}
      {totalPaginas > 1 && (
        <div className="pagination">
          <button
            onClick={handlePaginaAnterior}
            disabled={paginaActual === 1}
            aria-label="Página anterior"
          >
            ← Anterior
          </button>

          <span>
            Página {paginaActual} de {totalPaginas}
          </span>

          <button
            onClick={handlePaginaSiguiente}
            disabled={paginaActual === totalPaginas}
            aria-label="Página siguiente"
          >
            Siguiente →
          </button>
        </div>
      )}
    </div>
  );
};

export default CajaHistoryList;
