import ProductExpirationFields from '../components/ProductExpirationFields';
import ProductBatchSummary from '../components/ProductBatchSummary';

export default function ProduceProductFields({ values, errors, onFieldChange, onExpirationMode, isEditing, productId, onOpenBatches }) {
  return <>
    {isEditing && <ProductBatchSummary productId={productId} onOpenBatches={onOpenBatches} />}
    <ProductExpirationFields values={values} errors={errors} onExpirationMode={onExpirationMode} onFieldChange={onFieldChange} isEditing={isEditing} showTrackStockHint />
  </>;
}
