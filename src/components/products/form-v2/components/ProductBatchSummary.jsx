import { useEffect, useMemo, useState } from 'react';
import { extractCalendarDate } from '../../../../utils/dateUtils';
import { queryBatchesByProductIdAndActive } from '../../../../services/database';
import { getProductBatchSummary } from '../../../../services/products/productBatchSummary';
import { EXPIRY_DAYS_THRESHOLD } from '../../../../services/db/utils';

const formatDate = (value) => {
  const calendarDate = extractCalendarDate(value);
  if (!calendarDate) return null;
  const [year, month, day] = calendarDate.split('-');
  return `${day}/${month}/${year}`;
};

export { getProductBatchSummary } from '../../../../services/products/productBatchSummary';

export default function ProductBatchSummary({ productId, onOpenBatches, onSummary }) {
  const [batches, setBatches] = useState([]);

  useEffect(() => {
    if (!productId) return undefined;
    let cancelled = false;
    queryBatchesByProductIdAndActive(productId)
      .then((result) => { if (!cancelled) setBatches(Array.isArray(result) ? result : []); })
      .catch(() => { if (!cancelled) setBatches([]); });
    return () => { cancelled = true; };
  }, [productId]);

  const summary = useMemo(() => getProductBatchSummary(batches), [batches]);
  const { activeBatchCount, nearestExpiryDate, manufacturerBatchId, daysUntilExpiry, expiryStatus } = summary;
  const isNearingExpiry = ['valid', 'expires_today'].includes(expiryStatus) && daysUntilExpiry <= EXPIRY_DAYS_THRESHOLD;
  useEffect(() => { onSummary?.(summary); }, [onSummary, summary]);
  const countLabel = activeBatchCount === 0
    ? 'Sin lotes activos'
    : `${activeBatchCount} lote${activeBatchCount === 1 ? '' : 's'} activo${activeBatchCount === 1 ? '' : 's'}`;

  return <section className="product-batch-summary" aria-label="Inventario por lotes"><div><h4>Inventario actual</h4><p>{countLabel}</p>{activeBatchCount > 0 && <>{nearestExpiryDate ? <p>Próxima caducidad: {formatDate(nearestExpiryDate)}</p> : <p>Sin fecha de caducidad</p>}{manufacturerBatchId && <p>Lote: {manufacturerBatchId}</p>}{isNearingExpiry && <p className="product-form-v2__error">⚠ Caducidad próxima. Este lote caduca en {daysUntilExpiry} día{daysUntilExpiry === 1 ? '' : 's'}.</p>}<small className="product-form-v2__hint">La fecha pertenece al lote existente. Para modificarla, utiliza “Lotes”.</small></>}</div><button type="button" className="product-batch-summary__action" onClick={onOpenBatches}>{activeBatchCount === 0 ? 'Registrar lote' : 'Ver lotes'}</button></section>;
}
