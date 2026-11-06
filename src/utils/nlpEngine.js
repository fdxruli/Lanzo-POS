export const normalizeText = (text = '') => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[¿?¡!.,;:]/g, ' ').replace(/\s+/g, ' ').trim();

/** Local calendar boundaries, shared by the local and cloud report requests. */
export const extractTimeframe = (text, now = new Date()) => {
  const normalized = normalizeText(text);
  const end = new Date(now);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let label = 'hoy';
  if (/ayer/.test(normalized)) {
    start.setDate(start.getDate() - 1);
    end.setTime(start.getTime()); end.setHours(23, 59, 59, 999);
    label = 'ayer';
  } else if (/semana pasada/.test(normalized)) {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    end.setTime(start.getTime() - 1);
    start.setDate(start.getDate() - 7); label = 'la semana pasada (lunes a domingo)';
  } else if (/semana/.test(normalized)) {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); label = 'esta semana (desde el lunes)';
  } else if (/mes pasado/.test(normalized)) {
    start.setDate(1); end.setTime(start.getTime() - 1); start.setMonth(start.getMonth() - 1); label = 'el mes pasado';
  } else if (/mes/.test(normalized)) {
    start.setDate(1); label = 'este mes';
  } else if (/ultimos? (\d+) dias?/.test(normalized)) {
    const days = Number(normalized.match(/ultimos? (\d+) dias?/)[1]);
    if (days < 1 || days > 366) return null;
    start.setDate(start.getDate() - days + 1); label = `los últimos ${days} días`;
  } else if (/\d|ano|año|lunes|martes|miercoles|jueves|viernes|sabado|domingo|anterior|pasad|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre/.test(normalized)) {
    return null;
  }
  return { label, start, end, dateFrom: start.toISOString(), dateTo: end.toISOString() };
};
