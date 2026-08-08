import { Plus } from 'lucide-react';
import ProductImagePicker from '../../ProductImagePicker';
import CategorySelect from '../../forms/CategorySelect';

export default function ProductDetailsAccordion({ values, categories, onFieldChange, onImageChange, onOpenCategoryManager }) {
  return <div className="product-form-v2__details"><ProductImagePicker compact imagePreview={values.imagePreview || values.image} hasImage={Boolean(values.imagePreview || values.image) && !values.imageRemoved} onImageChange={(event) => onImageChange(event.target.files?.[0])} onRemoveImage={() => onImageChange(null)} />
    <div className="product-form-v2__field"><label htmlFor="product-v2-category">Categoría</label><div className="product-form-v2__inline-control"><CategorySelect value={values.categoryId} onChange={(value) => onFieldChange('categoryId', value)} activeCategories={categories || []} className="product-form-v2__select" />{onOpenCategoryManager && <button type="button" className="product-form-v2__icon-button" onClick={onOpenCategoryManager} aria-label="Administrar categorías"><Plus size={16} aria-hidden="true" /></button>}</div></div>
    <div className="product-form-v2__field"><label htmlFor="product-v2-description">Descripción</label><textarea id="product-v2-description" rows="3" value={values.description} onChange={(event) => onFieldChange('description', event.target.value)} /></div>
  </div>;
}
