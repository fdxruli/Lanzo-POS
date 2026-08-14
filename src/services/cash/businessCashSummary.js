import { Money } from '../../utils/moneyMath';

const OPEN_STATUSES = new Set(['open', 'abierta']);
const HOUR_MS = 60 * 60 * 1000;

export const canShowBusinessCashSummary = ({
  isCloudCash = false,
  isReadOnly = false,
  cashActor = null,
  adminOpenSessions = null
} = {}) => Boolean(
  isCloudCash &&
  !isReadOnly &&
  !cashActor?.isStaff &&
  Array.isArray(adminOpenSessions)
);

const amountOf = (session, cloudKey, localKey) => (
  session?.[cloudKey] ?? session?.[localKey] ?? 0
);

export const isOpenBusinessCashSession = (session = {}) => (
  Boolean(session) &&
  OPEN_STATUSES.has(String(session.status ?? session.estado ?? '').toLowerCase()) &&
  !session.deleted_at &&
  !session.deletedAt
);

export const isStaffCashSession = (session = {}) => (
  String(session.device_role ?? session.deviceRole ?? '').toLowerCase() === 'staff' ||
  Boolean(session.staff_user_id ?? session.staffUserId) ||
  String(session.actor_key ?? session.actorKey ?? '').startsWith('staff:')
);

const sessionKey = (session, index) => String(session?.id || session?.cash_session_id || `unidentified-${index}`);

// The current-session RPC includes the active actor in admin_open_sessions. This
// normalizer intentionally deduplicates it by ID before calculating any amount.
const uniqueOpenSessions = (openSessions = [], currentCashSession = null) => {
  const sessions = Array.isArray(openSessions) ? openSessions : [];
  const byId = new Map();

  sessions.forEach((session, index) => {
    if (isOpenBusinessCashSession(session)) byId.set(sessionKey(session, index), session);
  });

  if (isOpenBusinessCashSession(currentCashSession)) {
    const currentKey = sessionKey(currentCashSession, 'current');
    if (!byId.has(currentKey)) byId.set(currentKey, currentCashSession);
  }

  return [...byId.values()];
};

const addAmount = (summary, field, value) => {
  summary[field] = Money.toExactString(Money.add(Money.init(summary[field]), Money.init(value)));
};

export const buildBusinessCashSummary = (openSessions = [], currentCashSession = null) => {
  const sessions = uniqueOpenSessions(openSessions, currentCashSession);
  const currentId = currentCashSession?.id || currentCashSession?.cash_session_id || null;
  const summary = {
    openCount: sessions.length,
    expectedCashTotal: '0',
    openingTotal: '0',
    cashSalesTotal: '0',
    customerPaymentsTotal: '0',
    entriesTotal: '0',
    exitsTotal: '0',
    currentActorTotal: '0',
    otherAdminTotal: '0',
    staffTotal: '0',
    sessions
  };

  sessions.forEach((session) => {
    const expectedCash = amountOf(session, 'expected_cash_total', 'total_teorico_cloud');
    addAmount(summary, 'expectedCashTotal', expectedCash);
    addAmount(summary, 'openingTotal', amountOf(session, 'opening_amount', 'monto_inicial'));
    addAmount(summary, 'cashSalesTotal', amountOf(session, 'cash_sales_total', 'ventas_efectivo'));
    addAmount(summary, 'customerPaymentsTotal', amountOf(session, 'customer_payments_total', 'abonos_fiado'));
    addAmount(summary, 'entriesTotal', amountOf(session, 'cash_entries_total', 'entradas_efectivo'));
    addAmount(summary, 'exitsTotal', amountOf(session, 'cash_exits_total', 'salidas_efectivo'));

    if (currentId && String(session.id || session.cash_session_id) === String(currentId)) {
      addAmount(summary, 'currentActorTotal', expectedCash);
    } else if (isStaffCashSession(session)) {
      addAmount(summary, 'staffTotal', expectedCash);
    } else {
      addAmount(summary, 'otherAdminTotal', expectedCash);
    }
  });

  return summary;
};

export const getCashSessionAge = (openedAt, now = Date.now()) => {
  const openedTime = Date.parse(openedAt || '');
  if (Number.isNaN(openedTime)) return { level: 'unknown', label: 'Fecha de apertura no disponible' };

  const hours = Math.max(0, Math.floor((now - openedTime) / HOUR_MS));
  const days = Math.floor(hours / 24);
  const label = days > 0
    ? `Abierta hace ${days} ${days === 1 ? 'día' : 'días'}`
    : `Abierta hace ${Math.max(hours, 1)} h`;

  if (days >= 3) return { level: 'review', label: 'Requiere revisión', detail: `${label}. Esta caja lleva varios días abierta.` };
  if (hours >= 24) return { level: 'important', label, detail: 'Caja abierta por más de 24 horas.' };
  if (hours >= 12) return { level: 'warning', label, detail: 'Caja abierta por más de 12 horas.' };
  return { level: 'normal', label };
};
