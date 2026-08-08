import ProductBatchSummary from '../components/ProductBatchSummary';
import ProductExpirationFields from '../components/ProductExpirationFields';

export default function GroceryProductFields({
  values,
  errors,
  onFieldChange,
  onExpirationMode,
  isEditing = false,
  productId,
  onOpenBatches,
  onBatchSummary,
  features = {},
  onOpenWholesale
}) {
  const tierCount = values.wholesaleTiers?.length || 0;

  return <>
    <div className="product-form-v2__field-grid">
      <div className="product-form-v2__field">
        <label htmlFor="product-v2-supplier">Proveedor</label>
        <input id="product-v2-supplier" value={values.supplier} onChange={(event) => onFieldChange('supplier', event.target.value)} />
      </div>
    </div>
    {features.hasWholesale && values.saleMode !== 'bulk' && <section className="product-form-v2__subsection" aria-label="Precios de mayoreo">
      <div className="product-form-v2__field-grid">
        <div><strong>Precios de mayoreo</strong><p className="product-form-v2__hint">{tierCount ? `${tierCount} nivel${tierCount === 1 ? '' : 'es'} configurado${tierCount === 1 ? '' : 's'}` : 'Sin niveles configurados'}</p></div>
        <div><button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={onOpenWholesale}>Configurar mayoreo</button></div>
      </div>
    </section>}
    {isEditing && productId && <ProductBatchSummary productId={productId} onOpenBatches={onOpenBatches} onSummary={onBatchSummary} />}
    <ProductExpirationFields values={values} errors={errors} onExpirationMode={onExpirationMode} onFieldChange={onFieldChange} isEditing={isEditing} />
  </>;
}
