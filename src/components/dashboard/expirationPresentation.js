import { extractCalendarDate } from '../../utils/dateUtils';

// La categoría representa el trabajo pendiente, no el tipo técnico de alerta.
export const getExpirationCategory = (item = {}) => {
  if (item.recordType === 'product' || item.type === 'Producto') return 'unbatched';
  if (
    item.operationalCategory === 'vida_util_vencida' ||
    item.alertType === 'VIDA_UTIL_VENCIDA' ||
    Number(item.daysRemaining) < 0
  ) return 'expired';
  return 'upcoming';
};

export const getExpirationStatus = (item = {}) => {
  const category = getExpirationCategory(item);
  if (category === 'unbatched') return 'Stock sin lote';
  const days = Number(item.daysRemaining);
  if (category === 'expired') {
    if (Number.isFinite(days) && days < 0) {
      const count = Math.abs(days);
      return 'Venció hace ' + count + (count === 1 ? ' día' : ' días');
    }
    return item.alertType === 'VIDA_UTIL_VENCIDA' ? 'Vida útil vencida' : 'Vencido';
  }
  if (item.alertType === 'REVISION_MERMA') return 'Revisar lote';
  if (!Number.isFinite(days)) return 'Fecha pendiente';
  if (days === 0) return 'Vence hoy';
  if (days === 1) return 'Vence mañana';
  return 'Vence en ' + days + ' días';
};

export const formatExpirationDate = (value) => {
  const civilDate = extractCalendarDate(value);
  if (!civilDate) return 'Sin fecha';
  const [year, month, day] = civilDate.split('-');
  return day + '/' + month + '/' + year;
};

export const getExpirationDateTitle = (item = {}) => {
  if (getExpirationCategory(item) === 'unbatched') return 'Fecha de revisión';
  if (item.alertType === 'REVISION_MERMA') return 'Fecha de revisión';
  if (item.alertType === 'VIDA_UTIL_ESTIMADA' || item.alertType === 'VIDA_UTIL_VENCIDA') return 'Vida útil estimada';
  return 'Caducidad';
};
