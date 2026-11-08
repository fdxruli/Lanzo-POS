// Períodos Cloud en días de calendario del dispositivo. Supabase usa fin exclusivo.
export const CLOUD_STATS_PERIODS = Object.freeze([
  { key: 'today', label: 'Hoy' },
  { key: 'last7', label: '7 días' },
  { key: 'last15', label: '15 días' },
  { key: 'thisMonth', label: 'Este mes' }
]);

export const buildCloudStatsRange = (key, now = new Date()) => {
  if (!CLOUD_STATS_PERIODS.some((period) => period.key === key)) {
    throw new Error('DASHBOARD_PERIOD_UNSUPPORTED');
  }
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (key === 'last7') start.setDate(start.getDate() - 6);
  if (key === 'last15') start.setDate(start.getDate() - 14);
  if (key === 'thisMonth') start.setDate(1);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
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

export const describeCloudStatsRange = (requestedRange) => {
  if (!requestedRange) return 'Rango no disponible';
  const from = new Date(requestedRange.dateFrom);
  const endInclusive = new Date(Date.parse(requestedRange.dateTo) - 1);
  const formatter = new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${formatter.format(from)} – ${formatter.format(endInclusive)}`;
};
