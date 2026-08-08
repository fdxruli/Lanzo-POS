import { CANONICAL_BUSINESS_TYPES } from '../../../../utils/businessType';
import { toNumber, variantKey } from './productFormNormalization';

export function validateProductForm(values, { activeRubro, isEditing = false } = {}) {
  const fieldErrors = {};
  const globalErrors = [];
  const stock = toNumber(values.stock);
  const cost = toNumber(values.cost);
  const price = toNumber(values.price);
  const minStock = toNumber(values.minStock);
  const maxStock = toNumber(values.maxStock);
  const isIngredient = values.productType === 'ingredient' || values.restaurantType === 'ingredient';

  if (!String(values.name || '').trim()) fieldErrors.name = 'El nombre es obligatorio.';
  if (!isIngredient && price <= 0) fieldErrors.price = 'El precio de venta debe ser mayor que cero.';
  if (cost < 0) fieldErrors.cost = 'El costo no puede ser negativo.';
  if (values.trackStock && stock < 0) fieldErrors.stock = 'La existencia inicial no puede ser negativa.';
  if (values.trackStock && minStock < 0) fieldErrors.minStock = 'El stock mínimo no puede ser negativo.';
  if (values.trackStock && maxStock < 0) fieldErrors.maxStock = 'El stock máximo no puede ser negativo.';
  if (values.trackStock && values.minStock !== '' && values.maxStock !== '' && maxStock < minStock) fieldErrors.maxStock = 'El máximo no puede ser menor que el mínimo.';
  if (values.saleMode === 'fractioned' || values.conversionFactor?.enabled) {
    if (!String(values.conversionFactor?.purchaseUnit || '').trim()) fieldErrors.purchaseUnit = 'Selecciona la unidad en la que compras el producto.';
    if (toNumber(values.conversionFactor?.factor) <= 1) fieldErrors.conversionFactor = 'Indica cuántas unidades contiene la presentación de compra.';
    if (toNumber(values.conversionFactor?.purchaseCost) <= 0) fieldErrors.purchaseCost = 'Indica cuánto te cuesta la presentación de compra.';
  }
  if (values.expirationMode === 'STRICT') {
    if (values.shelfLifeValue) fieldErrors.expirationMode = 'La fecha concreta y la vida útil no pueden coexistir.';
    if (!isEditing && values.trackStock && stock > 0 && !values.expiryDate) fieldErrors.expiryDate = 'Indica la fecha de caducidad de la entrada inicial.';
  }
  if (values.expirationMode === 'SHELF_LIFE') {
    if (values.expiryDate) fieldErrors.expirationMode = 'La vida útil y una fecha concreta no pueden coexistir.';
    if (toNumber(values.shelfLifeValue) <= 0) fieldErrors.shelfLifeValue = 'Indica una vida útil mayor que cero.';
  }
  if (activeRubro === CANONICAL_BUSINESS_TYPES.FARMACIA && !isEditing && values.trackStock && stock > 0) {
    if (!String(values.manufacturerBatchId || '').trim()) fieldErrors.manufacturerBatchId = 'Indica el lote del fabricante.';
    if (!values.expiryDate) fieldErrors.expiryDate = 'Indica la caducidad de la entrada inicial.';
  }
  if (values.hasVariants) {
    const active = values.quickVariants.filter((variant) => variant.talla || variant.color || variant.sku);
    const seen = new Set();
    active.forEach((variant) => {
      if (!variant.talla || !variant.color) fieldErrors.quickVariants = 'Cada variante debe tener talla y color.';
      const key = variantKey(variant);
      if (variant.talla && variant.color && seen.has(key)) fieldErrors.quickVariants = 'No puede haber combinaciones de variantes duplicadas.';
      seen.add(key);
    });
  }
  if (values.restaurantType === 'dish' && values.recipe.length > 0 && !values.recipe.every((item) => (item?.ingredientId || item?.productId) && toNumber(item.quantity) > 0)) fieldErrors.recipe = 'La receta contiene ingredientes incompletos.';
  if (Object.keys(fieldErrors).length > 0) globalErrors.push('Revisa los campos marcados antes de guardar.');
  return { fieldErrors, globalErrors };
}
