import { useState, useMemo } from 'react';
import {
  AlertCircle,
  Archive,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  UserRound
} from 'lucide-react';
import { Money } from '../../../utils/moneyMath';

const CajaHistoryList = ({ historial, itemsPerPage = 10, title = 'Historial de cortes', eyebrow = 'Turnos anteriores', isCloudCash = false }) => {
  const [paginaActual, setPaginaActual] = useState(1);

  const historialRender = useMemo(() => {
    const startIndex = (paginaActual - 1) * itemsPerPage;
    const historialPaginado = historial.slice(startIndex, startIndex + itemsPerPage);

    return historialPaginado.map(c => {
      const diffSafe = Money.init(c.diferencia || 0);
      const isCuadrada = diffSafe.abs().lt(1);
      const staffUserId = c.staffUserId || c.staff_user_id || null;
      const actorKey = c.actorKey || c.actor_key || null;
      const responsible = c.responsable_apertura || c.responsibleName || c.staff_display_name || c.staffDisplayName || null;
      const opened = c.fecha_apertura ? new Date(c.fecha_apertura) : null;
      const closed = c.fecha_cierre ? new Date(c.fecha_cierre) : null;
      const isCloudSession = Boolean(c.cloudCash || isCloudCash);
      const isStaffSession = c.deviceRole === 'staff' || c.device_role === 'staff' || staffUserId;

      return {
        id: c.id,
        fecha: opened ? opened.toLocaleDateString() : 'Sin fecha',
        hora: opened ? opened.toLocaleTimeString() : '',
        cierreFecha: closed ? closed.toLocaleString() : null,
        estado: c.estado || 'cerrada',
        responsible,
        actor: isCloudSession ? (isStaffSession ? 'Caja de staff' : 'Caja admin') : 'Caja local',
        actorKey,
        staffUserId,
        isCuadrada,
        cierre: c.monto_cierre ? `$${Money.toNumber(c.monto_cierre || 0).toFixed(2)}` : 'N/A',
        dif: `${diffSafe.gt(0) ? '+' : ''}$${Money.toNumber(diffSafe).toFixed(2)}`,
        difTone: diffSafe.gt(0) ? 'positive' : 'negative'
      };
    });
  }, [historial, paginaActual, itemsPerPage, isCloudCash]);

  const totalPaginas = Math.ceil(historial.length / itemsPerPage);

  const handlePaginaAnterior = () => setPaginaActual(p => Math.max(1, p - 1));
  const handlePaginaSiguiente = () => setPaginaActual(p => Math.min(totalPaginas, p + 1));

  const sectionHeading = (
    <div className="section-header">
      <div className="section-heading">
        <span className="section-heading-icon" aria-hidden="true">
          <CalendarClock size={19} />
        </span>
        <div>
          <p className="section-eyebrow">{eyebrow}</p>
          <h3 id="history-title" className="section-title">{title}</h3>
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
                <strong className="movement-title">{c.fecha} {c.hora}</strong>
                <span className={`status-badge ${c.isCuadrada ? 'success' : 'error'}`}>
                  {c.isCuadrada ? 'Cuadrada' : 'Descuadre'}
                </span>
              </div>
              <div className="movement-details">
                <span>Estado: {c.estado}</span>
                <span>Cierre: {c.cierre}</span>
                {c.responsible && <span><UserRound size={12} aria-hidden="true" /> {c.responsible}</span>}
                {c.actor && <span>{c.actor}</span>}
                {c.staffUserId && <span>Staff ID: {String(c.staffUserId).slice(0, 8)}</span>}
                {c.actorKey && <span>Actor: {c.actorKey}</span>}
                {c.cierreFecha && <span>Cerrada: {c.cierreFecha}</span>}
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
          <button onClick={handlePaginaAnterior} disabled={paginaActual === 1} aria-label="Página anterior">
            <ChevronLeft size={16} aria-hidden="true" />
            Anterior
          </button>
          <span>Página {paginaActual} de {totalPaginas}</span>
          <button onClick={handlePaginaSiguiente} disabled={paginaActual === totalPaginas} aria-label="Página siguiente">
            Siguiente
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      )}
    </section>
  );
};

export default CajaHistoryList;
