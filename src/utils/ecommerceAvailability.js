const DEFAULT_TIMEZONE = 'America/Mexico_City';
const DEFAULT_REFRESH_MS = 60_000;

const dateValue = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const dateParts = (value, timezone) => {
  const date = dateValue(value);
  if (!date) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || DEFAULT_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return null;
  }
};

const nextLocalDate = (localDate) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate || '')) return '';
  const [year, month, day] = localDate.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
};

export function formatBusinessTime(value, timezone = DEFAULT_TIMEZONE) {
  const date = dateValue(value);
  if (!date) return '';
  try {
    return new Intl.DateTimeFormat('es-MX', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit'
    }).format(date);
  } catch {
    return '';
  }
}

export function businessLocalDateTimeToIso(value, timezone = DEFAULT_TIMEZONE) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value || '');
  if (!match) return '';
  const desired = match.slice(1).map(Number);
  const desiredUtc = Date.UTC(desired[0], desired[1] - 1, desired[2], desired[3], desired[4]);
  let guess = desiredUtc;
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    });
    for (let index = 0; index < 2; index += 1) {
      const parts = formatter.formatToParts(new Date(guess));
      const get = (type) => Number(parts.find((part) => part.type === type)?.value);
      const representedUtc = Date.UTC(
        get('year'), get('month') - 1, get('day'), get('hour'), get('minute')
      );
      guess += desiredUtc - representedUtc;
    }
    return new Date(guess).toISOString();
  } catch {
    return '';
  }
}

export function getAvailabilityLabel(availability) {
  if (availability?.acceptingOrders === true && availability?.code === 'OPEN') return 'Abierto';
  if (availability?.code === 'ORDERS_PAUSED') return 'Pedidos pausados';
  if (availability?.code === 'OUTSIDE_BUSINESS_HOURS') return 'Cerrado';
  return 'No acepta pedidos';
}

export function getAvailabilityDetail(availability) {
  if (!availability || typeof availability !== 'object') return '';
  const timezone = availability.timezone || DEFAULT_TIMEZONE;

  if (availability.code === 'ORDERS_PAUSED') {
    const resumeTime = formatBusinessTime(availability.pauseUntil, timezone);
    return resumeTime
      ? `Volvemos a recibir pedidos a las ${resumeTime}.`
      : 'El negocio reanudará los pedidos manualmente.';
  }

  if (availability.acceptingOrders === true && availability.code === 'OPEN') {
    const closeTime = formatBusinessTime(availability.nextCloseAt, timezone);
    return closeTime ? `Cierra hoy a las ${closeTime}.` : 'Estamos recibiendo pedidos.';
  }

  if (availability.code === 'OUTSIDE_BUSINESS_HOURS') {
    const openTime = formatBusinessTime(availability.nextOpenAt, timezone);
    if (!openTime) return 'Consulta el catálogo y vuelve más tarde.';
    const openDate = dateParts(availability.nextOpenAt, timezone);
    if (openDate && openDate === availability.localDate) return `Abre hoy a las ${openTime}.`;
    if (openDate && openDate === nextLocalDate(availability.localDate)) return `Abre mañana a las ${openTime}.`;
    return `Próxima apertura: ${new Intl.DateTimeFormat('es-MX', {
      timeZone: timezone,
      weekday: 'long',
      day: 'numeric',
      month: 'short'
    }).format(dateValue(availability.nextOpenAt))}, ${openTime}.`;
  }

  if (availability.code === 'SCHEDULE_NOT_CONFIGURED') {
    return 'El negocio no puede recibir pedidos por ahora.';
  }
  if (availability.code === 'ORDERING_DISABLED') {
    return 'Este negocio no está recibiendo pedidos por ahora.';
  }
  return 'Puedes consultar el catálogo, pero el checkout no está disponible.';
}

export function getAvailabilityRefreshDelay(
  availability,
  { now = Date.now(), fallbackMs = DEFAULT_REFRESH_MS } = {}
) {
  const changeAt = dateValue(availability?.nextChangeAt);
  if (!changeAt) return fallbackMs;
  const delay = changeAt.getTime() - Number(now) + 500;
  if (!Number.isFinite(delay) || delay <= 0) return 1_000;
  return Math.max(1_000, Math.min(fallbackMs, delay));
}

export const ecommerceAvailabilityDefaults = Object.freeze({
  timezone: DEFAULT_TIMEZONE,
  refreshMs: DEFAULT_REFRESH_MS
});
