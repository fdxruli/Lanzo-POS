import {
  addBusinessCalendarDays,
  formatBusinessInstant,
  startOfBusinessDay,
  startOfBusinessMonth
} from '../../utils/businessTime';

// Períodos Cloud en días de calendario del negocio. Supabase usa fin exclusivo.
export const CLOUD_STATS_PERIODS = Object.freeze([
  { key: 'today', label: 'Hoy' },
  { key: 'last7', label: '7 días' },
  { key: 'last15', label: '15 días' },
  { key: 'thisMonth', label: 'Este mes' }
]);

export const buildCloudStatsRange = (key, now = new Date(), timeZone = null) => {
  if (!CLOUD_STATS_PERIODS.some((period) => period.key === key)) {
    throw new Error('DASHBOARD_PERIOD_UNSUPPORTED');
  }
  const today = startOfBusinessDay(now, timeZone);
  const start = key === 'thisMonth'
    ? startOfBusinessMonth(now, 0, timeZone)
    : key === 'last7'
      ? addBusinessCalendarDays(today, -6, timeZone)
      : key === 'last15'
        ? addBusinessCalendarDays(today, -14, timeZone)
        : today;
  const end = addBusinessCalendarDays(today, 1, timeZone);
  if (!start || !end) throw new Error('DASHBOARD_PERIOD_TIMEZONE_INVALID');
  return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
};

export const cloudReportMatchesRange = (report, requestedRange) => {
  const range = report?.dateRange || report?.date_range || report?.raw?.date_range || {};
  const from = range.date_from || range.start || range.from || range.dateFrom;
  const to = range.date_to || range.end || range.to || range.dateTo;
  if (!requestedRange || !from || !to) return false;
  return Number.isFinite(Date.parse(from)) && Number.isFinite(Date.parse(to))
    && Date.parse(from) === Date.parse(requestedRange.dateFrom)
    && Date.parse(to) === Date.parse(requestedRange.dateTo);
};

export const describeCloudStatsRange = (requestedRange, timeZone = null) => {
  if (!requestedRange) return 'Rango no disponible';
  const from = new Date(requestedRange.dateFrom);
  const endInclusive = new Date(Date.parse(requestedRange.dateTo) - 1);
  const options = { day: '2-digit', month: '2-digit', year: 'numeric' };
  const fromLabel = formatBusinessInstant(from, timeZone, options);
  const endLabel = formatBusinessInstant(endInclusive, timeZone, options);
  return `${fromLabel} – ${endLabel}`;
};
