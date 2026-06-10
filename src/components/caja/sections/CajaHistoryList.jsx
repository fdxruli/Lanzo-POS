import { useState, useMemo } from 'react';
import {
  AlertCircle,
  Archive,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { Money } from '../../../utils/moneyMath';

const CajaHistoryList = ({ historial, itemsPerPage = 10 }) => {
  const [paginaActual, setPaginaActual] = useState(1);

  const historialRender = useMemo(() => {
    const startIndex = (paginaActual - 1) * itemsPerPage;
    const historialPaginado = historial.slice(startIndex, startIndex + itemsPerPage);

    return historialPaginado.map(c => {
      const diffSafe = Money.init(c.diferencia || 0);
      const isCuadrada = diffSafe.abs().lt(1);

      return {
        id: c.id,
        fecha: new Date(c.fecha_apertura).toLocaleDateString(),
        isCuadrada,
        cierre: c.monto_cierre ? `$${Money.toNumber(c.monto_cierre || 0).toFixed(2)}` : 'N/A',
        dif: `${diffSafe.gt(0) ? '+' : ''}$${Money.toNumber(diffSafe).toFixed(2)}`,
        difTone: diffSafe.gt(0) ? 'positive' : 'negative'
      };
    });
  }, [historial, paginaActual, itemsPerPage]);

  const totalPaginas = Math.ceil(historial.length / itemsPerPage);

  const handlePaginaAnterior = () => {
    setPaginaActual(p => Math.max(1, p - 1));
  };

  const handlePaginaSiguiente = () => {
    setPaginaActual(p => Math.min(totalPaginas, p + 1));
  };

  const sectionHeading = (
    <div className="section-header">
      <div className="section-heading">
        <span className="section-heading-icon" aria-hidden="true">
          <CalendarClock size={19} />
        </span>
        <div>
          <p className="section-eyebrow">Turnos anteriores</p>
          <h3 id="history-title" className="section-title">Historial de cortes</h3>
        </div>
      </div>
      {historial.length > 0 && <span className="items-count">{historial.length}</span>}
    </div>
  );

  if (historial.length === 0) {
    return (
      <section id="caja-history-container" className="caja-card" aria-labelledby="history-title">
        {sectionHeading}
        <div className="empty-state">
          <Archive className="empty-state-icon" size={30} aria-hidden="true" />
          <p>No hay historial de cortes registrados.</p>
        </div>
      </section>
    );
  }

  return (
    <section id="caja-history-container" className="caja-card" aria-labelledby="history-title">
      {sectionHeading}

      <div className="history-list">
        {historialRender.map(c => (
          <div key={c.id} className="history-item">
            <span className={`history-status-icon ${c.isCuadrada ? 'success' : 'error'}`} aria-hidden="true">
              {c.isCuadrada ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
            </span>
            <div className="history-content">
              <div className="movement-header">
                <strong className="movement-title">{c.fecha}</strong>
                <span className={`status-badge ${c.isCuadrada ? 'success' : 'error'}`}>
                  {c.isCuadrada ? 'Cuadrada' : 'Descuadre'}
                </span>
              </div>
              <div className="movement-details">
                <span>Cierre: {c.cierre}</span>
                {!c.isCuadrada && (
                  <span className={`history-difference ${c.difTone}`}>Dif: {c.dif}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {totalPaginas > 1 && (
        <div className="pagination">
          <button
            onClick={handlePaginaAnterior}
            disabled={paginaActual === 1}
            aria-label="Página anterior"
          >
            <ChevronLeft size={16} aria-hidden="true" />
            Anterior
          </button>
          <span>Página {paginaActual} de {totalPaginas}</span>
          <button
            onClick={handlePaginaSiguiente}
            disabled={paginaActual === totalPaginas}
            aria-label="Página siguiente"
          >
            Siguiente
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      )}
    </section>
  );
};

export default CajaHistoryList;
