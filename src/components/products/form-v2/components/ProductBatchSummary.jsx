import { useEffect, useMemo, useState } from 'react';
import { getBatchExpiryStatus, extractCalendarDate } from '../../../../utils/dateUtils';
import { getBatchExpiryValue, isBatchActiveForFefo } from '../../../../services/products/fefoUtils';
import { queryBatchesByProductIdAndActive } from '../../../../services/database';

const formatDate = (value) => {
  const calendarDate = extractCalendarDate(value);
  if (!calendarDate) return null;
  const [year, month, day] = calendarDate.split('-');
  return `${day}/${month}/${year}`;
};

export const getProductBatchSummary = (batches = [], now = new Date()) => {
  const activeBatches = (Array.isArray(batches) ? batches : []).filter(isBatchActiveForFefo);
  const nextExpiryDate = activeBatches
    .map(getBatchExpiryValue)
    .filter((value) => ['valid', 'expires_today'].includes(getBatchExpiryStatus(value, now)))
    .sort((left, right) => extractCalendarDate(left).localeCompare(extractCalendarDate(right)))[0] || null;

  return { activeBatchCount: activeBatches.length, nextExpiryDate };
};

export default function ProductBatchSummary({ productId, onOpenBatches }) {
  const [batches, setBatches] = useState([]);

  useEffect(() => {
    if (!productId) return undefined;
    let cancelled = false;
    queryBatchesByProductIdAndActive(productId)
      .then((result) => { if (!cancelled) setBatches(Array.isArray(result) ? result : []); })
      .catch(() => { if (!cancelled) setBatches([]); });
    return () => { cancelled = true; };
  }, [productId]);

  const { activeBatchCount, nextExpiryDate } = useMemo(() => getProductBatchSummary(batches), [batches]);
  const countLabel = activeBatchCount === 0
    ? 'Sin lotes activos'
    : `${activeBatchCount} lote${activeBatchCount === 1 ? '' : 's'} activo${activeBatchCount === 1 ? '' : 's'}`;

  return <section className="product-batch-summary" aria-label="Inventario por lotes"><div><h4>Inventario por lotes</h4><p>{countLabel}</p>{activeBatchCount > 0 && <p>{nextExpiryDate ? `Próxima caducidad: ${formatDate(nextExpiryDate)}` : 'Sin fecha de caducidad'}</p>}</div><button type="button" className="product-batch-summary__action" onClick={onOpenBatches}>{activeBatchCount === 0 ? 'Registrar lote' : 'Ver lotes'}</button></section>;
}
