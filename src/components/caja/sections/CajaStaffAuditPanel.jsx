import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  RefreshCw,
  Search,
  ShieldCheck,
  UsersRound
} from 'lucide-react';
import { Money } from '../../../utils/moneyMath';

const formatMoney = (value) => `$${Money.toNumber(value || 0).toFixed(2)}`;

const formatDate = (value) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'N/A' : date.toLocaleString();
};

const getResponsibleName = (session = {}) => (
  session.responsable_apertura ||
  session.responsibleName ||
  session.responsible_name ||
  session.staff_display_name ||
  session.staffDisplayName ||
  session.metadata?.staff_display_name ||
  'Responsable no asignado'
);

const getStaffLabel = (session = {}) => (
  session.staff_display_name ||
  session.staffDisplayName ||
  session.metadata?.staff_display_name ||
  session.staffUserId ||
  session.staff_user_id ||
  null
);

const getStaffUserId = (session = {}) => session.staffUserId || session.staff_user_id || null;

const getDeviceLabel = (session = {}) => (
  session.deviceId ||
  session.device_id ||
  session.metadata?.device_id ||
  session.actorKey ||
  null
);

const getExpectedCash = (session = {}) => (
  session.total_teorico_cloud ??
  session.expected_cash_total ??
  session.detalle_cierre?.total_teorico ??
  Money.toExactString(
    Money.subtract(
      Money.add(
        Money.add(session.monto_inicial || 0, session.ventas_efectivo || 0),
        Money.add(session.abonos_fiado || 0, session.entradas_efectivo || 0)
      ),
      session.salidas_efectivo || 0
    )
  )
);

const getMovementCount = (session = {}) => (
  session.movements_count ??
  session.movement_count ??
  session.movementsCount ??
  session.metadata?.movements_count ??
  0
);

const matchesStatusFilter = (session = {}, statusFilter) => {
  if (!statusFilter || statusFilter === 'all') return true;
  const sessionStatus = session.estado || session.status || '';
  if (statusFilter === 'open') return ['open', 'abierta'].includes(sessionStatus);
  if (statusFilter === 'closed') return ['closed', 'cerrada'].includes(sessionStatus);
  return sessionStatus === statusFilter;
};

const matchesDateFilter = (session = {}, dateFrom, dateTo) => {
  const openedAt = session.fecha_apertura || session.opened_at;
  if (!openedAt) return true;
  const openedTime = new Date(openedAt).getTime();
  if (Number.isNaN(openedTime)) return true;
  if (dateFrom && openedTime < new Date(`${dateFrom}T00:00:00`).getTime()) return false;
  if (dateTo && openedTime > new Date(`${dateTo}T23:59:59`).getTime()) return false;
  return true;
};

const getStatusLabel = (session = {}) => {
  const status = session.estado || session.status || 'N/A';
  if (status === 'open') return 'abierta';
  if (status === 'closed') return 'cerrada';
  return status;
};

const buildStaffOptions = (sessions = []) => {
  const seen = new Set();
  return sessions
    .map((session) => {
      const staffUserId = getStaffUserId(session);
      const label = getStaffLabel(session) || getResponsibleName(session);
      const value = staffUserId || label;
      if (!value || seen.has(value)) return null;
      seen.add(value);
      return { value, label, staffUserId };
    })
    .filter(Boolean);
};

const matchesStaffFilter = (session, staffFilter) => {
  if (!staffFilter || staffFilter === 'all') return true;
  const staffUserId = getStaffUserId(session);
  if (staffUserId && staffUserId === staffFilter) return true;
  const haystack = [
    getResponsibleName(session),
    getStaffLabel(session),
    session.actorKey
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(staffFilter.toLowerCase());
};

const CajaStaffAuditPanel = ({
  adminCashSessions = [],
  listCashSessionsForAudit,
  isReadOnly = false
}) => {
  const [sessions, setSessions] = useState(adminCashSessions);
  const [status, setStatus] = useState('open');
  const [staffFilter, setStaffFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [message, setMessage] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    if (adminCashSessions.length > 0 && sessions.length === 0) {
      setSessions(adminCashSessions);
    }
  }, [adminCashSessions, sessions.length]);

  const staffOptions = useMemo(
    () => buildStaffOptions([...adminCashSessions, ...sessions]),
    [adminCashSessions, sessions]
  );

  const visibleSessions = useMemo(
    () => sessions.filter((session) => (
      matchesStatusFilter(session, status) &&
      matchesStaffFilter(session, staffFilter) &&
      matchesDateFilter(session, dateFrom, dateTo)
    )),
    [sessions, status, staffFilter, dateFrom, dateTo]
  );

  const refreshAudit = async () => {
    if (!listCashSessionsForAudit) return;
    setIsRefreshing(true);
    setMessage('');

    try {
      const selectedStaff = staffOptions.find((option) => option.value === staffFilter);
      const response = await listCashSessionsForAudit({
        status: status === 'all' ? null : status,
        staffUserId: selectedStaff?.staffUserId || null,
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
        limit: 100
      });

      if (response?.success === false) {
        setMessage(response.message || 'No se pudo cargar la auditoria de staff.');
        return;
      }

      setSessions(response?.cashSessions || []);
      setLastUpdated(new Date());
      setMessage(response?.readOnly || isReadOnly
        ? 'Mostrando ultimo estado cacheado. La caja cloud esta en solo consulta.'
        : '');
    } catch (error) {
      setMessage(error?.message || 'No se pudo cargar la auditoria de staff.');
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    refreshAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section id="caja-staff-audit" className="caja-card staff-audit-card" aria-labelledby="staff-audit-title">
      <div className="section-header">
        <div className="section-heading">
          <span className="section-heading-icon" aria-hidden="true">
            <UsersRound size={19} />
          </span>
          <div>
            <p className="section-eyebrow">Auditoria admin</p>
            <h3 id="staff-audit-title" className="section-title">Cajas de staff</h3>
          </div>
        </div>
        <span className="items-count">{visibleSessions.length}</span>
      </div>

      <div className="cash-opening-notice">
        <ShieldCheck size={18} aria-hidden="true" />
        <p>Vista separada para auditar cajas de staff. La caja propia del admin se mantiene fuera de este panel.</p>
      </div>

      {(message || isReadOnly) && (
        <div className="cash-opening-notice cash-opening-notice--warning">
          <ShieldCheck size={18} aria-hidden="true" />
          <p>{message || 'Caja cloud en modo solo consulta. Puedes revisar el ultimo estado cacheado.'}</p>
        </div>
      )}

      <div className="staff-audit-filters">
        <label className="filter-control">
          <Search size={17} aria-hidden="true" />
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="filter-select" aria-label="Filtrar auditoria por estado">
            <option value="open">Abiertas</option>
            <option value="closed">Cerradas</option>
            <option value="all">Todas</option>
          </select>
        </label>

        <label className="filter-control">
          <UsersRound size={17} aria-hidden="true" />
          <select value={staffFilter} onChange={(event) => setStaffFilter(event.target.value)} className="filter-select" aria-label="Filtrar auditoria por staff">
            <option value="all">Todos los staff</option>
            {staffOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="filter-control">
          <CalendarDays size={17} aria-hidden="true" />
          <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="search-input" aria-label="Fecha desde" />
        </label>

        <label className="filter-control">
          <CalendarDays size={17} aria-hidden="true" />
          <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="search-input" aria-label="Fecha hasta" />
        </label>

        <button type="button" className="btn-clear-filters staff-audit-refresh" onClick={refreshAudit} disabled={isRefreshing}>
          <RefreshCw size={16} aria-hidden="true" />
          {isRefreshing ? 'Actualizando' : 'Actualizar'}
        </button>
      </div>

      {lastUpdated && (
        <p className="staff-audit-meta">Actualizado: {lastUpdated.toLocaleTimeString()}</p>
      )}

      <div className="staff-audit-list">
        {visibleSessions.length === 0 ? (
          <div className="empty-state">
            <UsersRound className="empty-state-icon" size={30} aria-hidden="true" />
            <p>No hay cajas de staff para los filtros actuales.</p>
          </div>
        ) : (
          visibleSessions.map((session) => {
            const staffLabel = getStaffLabel(session);
            const deviceLabel = getDeviceLabel(session);
            const statusLabel = getStatusLabel(session);
            const statusTone = statusLabel === 'abierta' ? 'success' : 'neutral';
            const difference = Money.init(session.diferencia || session.cash_difference || 0);

            return (
              <article key={session.id} className="staff-audit-item">
                <div className="staff-audit-item-header">
                  <div>
                    <strong>{getResponsibleName(session)}</strong>
                    <div className="movement-details">
                      {staffLabel && <span>Staff: {staffLabel}</span>}
                      {deviceLabel && <span>Dispositivo: {deviceLabel}</span>}
                    </div>
                  </div>
                  <span className={`status-badge ${statusTone}`}>
                    {statusLabel}
                  </span>
                </div>

                <div className="staff-audit-grid">
                  <span><small>Apertura</small><strong>{formatDate(session.fecha_apertura)}</strong></span>
                  <span><small>Cierre</small><strong>{formatDate(session.fecha_cierre)}</strong></span>
                  <span><small>Monto inicial</small><strong>{formatMoney(session.monto_inicial)}</strong></span>
                  <span><small>Entradas</small><strong>{formatMoney(session.entradas_efectivo)}</strong></span>
                  <span><small>Salidas</small><strong>{formatMoney(session.salidas_efectivo)}</strong></span>
                  <span><small>Abonos/clientes</small><strong>{formatMoney(session.abonos_fiado || session.customer_payments_total)}</strong></span>
                  <span><small>Efectivo esperado</small><strong>{formatMoney(getExpectedCash(session))}</strong></span>
                  <span><small>Diferencia</small><strong className={difference.eq(0) ? '' : difference.gt(0) ? 'amount positive' : 'amount negative'}>{formatMoney(difference)}</strong></span>
                  <span><small>Movimientos</small><strong>{getMovementCount(session)}</strong></span>
                </div>
              </article>
            );
          })
        )}
      </div>

      <p className="staff-audit-meta">Detalle completo de movimientos pendiente de integrarse cuando el hook exponga esa consulta.</p>
    </section>
  );
};

export default CajaStaffAuditPanel;
