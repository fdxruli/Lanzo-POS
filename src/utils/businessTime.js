const DATE_PARTS_FORMATTER_OPTIONS = Object.freeze({
  calendar: 'gregory',
  numberingSystem: 'latn',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

const DATE_TIME_PARTS_FORMATTER_OPTIONS = Object.freeze({
  ...DATE_PARTS_FORMATTER_OPTIONS,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
});

export const isValidTimeZone = (timeZone) => {
  if (typeof timeZone !== 'string' || !timeZone.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timeZone.trim() });
    return true;
  } catch {
    return false;
  }
};

const readParts = (value, timeZone, withTime = false) => {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;

  if (!isValidTimeZone(timeZone)) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      ...(withTime ? {
        hour: date.getHours(),
        minute: date.getMinutes(),
        second: date.getSeconds()
      } : {})
    };
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone.trim(),
    ...(withTime ? DATE_TIME_PARTS_FORMATTER_OPTIONS : DATE_PARTS_FORMATTER_OPTIONS)
  });
  const parts = Object.fromEntries(formatter.formatToParts(date)
    .filter(({ type }) => type !== 'literal')
    .map(({ type, value: partValue }) => [type, Number(partValue)]));
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    ...(withTime ? { hour: parts.hour, minute: parts.minute, second: parts.second } : {})
  };
};

export const getBusinessDateParts = (value, timeZone = null) => readParts(value, timeZone, false);

export const getBusinessDateKey = (value, timeZone = null) => {
  const parts = getBusinessDateParts(value, timeZone);
  return parts
    ? `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
    : null;
};

const wallClockAsUtc = ({ year, month, day, hour = 0, minute = 0, second = 0 }) => (
  Date.UTC(year, month - 1, day, hour, minute, second)
);

export const businessDateTimeToInstant = (parts, timeZone = null) => {
  if (!parts || !Number.isInteger(parts.year) || !Number.isInteger(parts.month)
    || !Number.isInteger(parts.day)) return null;
  if (!isValidTimeZone(timeZone)) {
    const local = new Date(parts.year, parts.month - 1, parts.day,
      parts.hour || 0, parts.minute || 0, parts.second || 0);
    return Number.isFinite(local.getTime()) ? local : null;
  }

  const targetWallClock = wallClockAsUtc(parts);
  let candidate = targetWallClock;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = readParts(new Date(candidate), timeZone, true);
    if (!observed) return null;
    const correction = targetWallClock - wallClockAsUtc(observed);
    candidate += correction;
    if (correction === 0) return new Date(candidate);
  }

  return new Date(candidate);
};

export const startOfBusinessDay = (value = new Date(), timeZone = null) => {
  const parts = getBusinessDateParts(value, timeZone);
  return parts ? businessDateTimeToInstant({ ...parts, hour: 0, minute: 0, second: 0 }, timeZone) : null;
};

export const addBusinessCalendarDays = (value, days, timeZone = null) => {
  const parts = getBusinessDateParts(value, timeZone);
  if (!parts || !Number.isFinite(Number(days))) return null;
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + Number(days)));
  return businessDateTimeToInstant({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0
  }, timeZone);
};

export const startOfBusinessMonth = (value = new Date(), monthOffset = 0, timeZone = null) => {
  const parts = getBusinessDateParts(value, timeZone);
  if (!parts || !Number.isFinite(Number(monthOffset))) return null;
  const month = new Date(Date.UTC(parts.year, parts.month - 1 + Number(monthOffset), 1));
  return businessDateTimeToInstant({
    year: month.getUTCFullYear(),
    month: month.getUTCMonth() + 1,
    day: 1,
    hour: 0,
    minute: 0,
    second: 0
  }, timeZone);
};

export const businessDateKeyToStart = (dateKey, timeZone = null) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
  if (!match) return null;
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const validation = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (validation.getUTCFullYear() !== parts.year
    || validation.getUTCMonth() + 1 !== parts.month
    || validation.getUTCDate() !== parts.day) return null;
  return businessDateTimeToInstant({ ...parts, hour: 0, minute: 0, second: 0 }, timeZone);
};

export const formatBusinessInstant = (value, timeZone = null, options = {}, locale = 'es-MX') => {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    ...options,
    ...(isValidTimeZone(timeZone) ? { timeZone: timeZone.trim() } : {})
  }).format(date);
};

export const formatBusinessDateKey = (dateKey, timeZone = null, options = {}) => {
  const instant = businessDateKeyToStart(dateKey, timeZone);
  if (!instant) return null;
  return formatBusinessInstant(instant, timeZone, {
    year: 'numeric', month: '2-digit', day: '2-digit', ...options
  });
};
