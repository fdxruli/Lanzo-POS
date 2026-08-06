import ProductExpirationFields from '../components/ProductExpirationFields';
import RestauranteFields from '../../fieldsets/RestauranteFields';

const types = [
  { value: 'dish', label: 'Platillo' },
  { value: 'drink', label: 'Bebida' },
  { value: 'ready', label: 'Producto listo' },
  { value: 'ingredient', label: 'Insumo' }
];

export default function RestaurantProductFields({ values, errors, onFieldChange, onTrackStock, onExpirationMode, onManageRecipe }) {
  const isDish = values.restaurantType === 'dish';
  const selectType = (type) => {
    const isIngredient = type === 'ingredient';
    onFieldChange('restaurantType', type);
    onFieldChange('productType', isIngredient ? 'ingredient' : 'sellable');
    if (isIngredient) {
      onFieldChange('price', 0);
      onFieldChange('margin', '');
    }
    if (type === 'dish') onTrackStock(false);
  };

  return <>
    <div className="product-form-v2__segmented" role="group" aria-label="Tipo de producto">
      {types.map((type) => <button type="button" key={type.value} className={values.restaurantType === type.value ? 'is-active' : ''} onClick={() => selectType(type.value)}>{type.label}</button>)}
    </div>
    {isDish ? <div className="product-form-v2__subsection">
      <h4>Preparación y venta</h4>
      <RestauranteFields productType="sellable" setProductType={() => {}} hideTypeSelector onManageRecipe={onManageRecipe} printStation={values.printStation} setPrintStation={(value) => onFieldChange('printStation', value)} prepTime={values.prepTime} setPrepTime={(value) => onFieldChange('prepTime', value)} modifiers={values.modifiers} setModifiers={(value) => onFieldChange('modifiers', value)} />
      {errors.recipe && <small className="product-form-v2__error">{errors.recipe}</small>}
    </div> : <>
      <div className="product-form-v2__field"><label htmlFor="product-v2-restaurant-unit">Unidad</label><input id="product-v2-restaurant-unit" value={values.unit} onChange={(event) => onFieldChange('unit', event.target.value)} /></div>
      <ProductExpirationFields values={values} errors={errors} onExpirationMode={onExpirationMode} onFieldChange={onFieldChange} />
    </>}
  </>;
}
