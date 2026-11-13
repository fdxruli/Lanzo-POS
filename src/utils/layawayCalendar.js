// A layaway deadline is a business calendar date, never an instant or phone timezone.
const DATE_RE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})(?:T|$)/;

export const isValidBusinessTimezone = (timezone) => {
  if (typeof timezone !== 'string' || !timezone.includes('/') || timezone.length > 128) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
};

export const getLayawayCalendarDate = (value) => {
  const match = typeof value === 'string' ? value.match(DATE_RE) : null;
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(m) - 1
    || date.getUTCDate() !== Number(d)) return null;
  return `${y}-${m}-${d}`;
};

export const getBusinessCalendarDate = (timezone, now = new Date()) => {
  if (!isValidBusinessTimezone(timezone) || !(now instanceof Date) || !Number.isFinite(now.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const part = (key) => parts.find((item) => item.type === key)?.value;
  return getLayawayCalendarDate(`${part('year')}-${part('month')}-${part('day')}`);
};

export const addBusinessCalendarDays = (day, days) => {
  const date = getLayawayCalendarDate(day);
  if (!date || !Number.isInteger(days)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};

// true = expired, false = current, null = date or business timezone unverified.
export const isLayawayDeadlineOverdue = (deadline, timezone, now = new Date()) => {
  const today = getBusinessCalendarDate(timezone, now);
  const due = getLayawayCalendarDate(deadline);
  if (!today || !due) return null;
  return today > due;
};

export const assertLayawayPaymentAllowed = (layaway, timezone, now = new Date()) => {
  const status = String(layaway?.status || '').toLowerCase();
  if (!['active', 'ready'].includes(status) || status === 'ready'
      || Number(layaway?.totalAmount ?? 0) - Number(layaway?.paidAmount ?? 0) <= 0.005) {
    const error = new Error('Este apartado ya no admite abonos.');
    error.code = 'LAYAWAY_NOT_PAYABLE';
    throw error;
  }
  const overdue = isLayawayDeadlineOverdue(layaway?.deadline, timezone, now);
  if (overdue === null && isValidBusinessTimezone(timezone)) {
    const error = new Error('La fecha límite del apartado no es válida.');
    error.code = 'LAYAWAY_DEADLINE_INVALID';
    throw error;
  }
  if (overdue) {
    const error = new Error('Este apartado está vencido; no admite nuevos abonos.');
    error.code = 'LAYAWAY_OVERDUE';
    throw error;
  }
};

// Legacy UI behavior while the business has not confirmed a timezone.
// Never use the device calendar as authoritative Cloud validation.
export const isLayawayOverdueForDisplay = (deadline, timezone, now = new Date()) => {
  if (isValidBusinessTimezone(timezone)) return isLayawayDeadlineOverdue(deadline, timezone, now) === true;
  const due = getLayawayCalendarDate(deadline);
  if (!due || !(now instanceof Date) || !Number.isFinite(now.getTime())) return false;
  const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')].join('-');
  return today > due;
};
