import { extractCalendarDate } from '../../utils/dateUtils';

// Separar la clasificación operativa del tipo de registro: un producto sin lote
// también puede tener vida útil vencida y debe conservar su prioridad.
export const getExpirationCategory = (item = {}) => {
  if (
    item.operationalCategory === 'vida_util_vencida' ||
    item.alertType === 'VIDA_UTIL_VENCIDA' ||
    item.operationalCategory === 'vencido' ||
    item.expiryStatus === 'expired'
  ) return 'expired';
  if (item.recordType === 'product' || item.type === 'Producto') return 'unbatched';
  if (item.alertType === 'REVISION_MERMA') return 'upcoming';
  if (Number(item.daysRemaining) < 0) return 'expired';
  return 'upcoming';
};

export const getExpirationStatus = (item = {}) => {
  const category = getExpirationCategory(item);
  if (item.operationalCategory === 'vida_util_vencida' || item.alertType === 'VIDA_UTIL_VENCIDA') {
    return 'Vida útil vencida';
  }
  if (category === 'unbatched') return item.statusLabel || 'Stock sin lote';
  if (item.alertType === 'REVISION_MERMA') return 'Revisar merma';
  const days = Number(item.daysRemaining);
  if (category === 'expired') {
    if (Number.isFinite(days) && days < 0) {
      const count = Math.abs(days);
      return 'Venció hace ' + count + (count === 1 ? ' día' : ' días');
    }
    return 'Vencido';
  }
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
  if (item.operationalCategory === 'vida_util_vencida' || item.alertType === 'VIDA_UTIL_VENCIDA') return 'Vida útil estimada';
  if (item.recordType === 'product' || item.type === 'Producto') return 'Fecha de revisión';
  if (item.alertType === 'REVISION_MERMA') return 'Fecha de revisión';
  if (item.alertType === 'VIDA_UTIL_ESTIMADA') return 'Vida útil estimada';
  return 'Caducidad';
};
