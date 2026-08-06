import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getProductFormDefaults } from '../config/productFormDefaults';
import { normalizeProductRubro } from '../config/productRubroConfig';
import { buildProductFormPayload } from '../domain/buildProductFormPayload';
import { toNumber } from '../domain/productFormNormalization';
import { validateProductForm } from '../domain/validateProductForm';

export function useProductFormV2({ activeRubro, capabilities, productToEdit, onSave } = {}) {
  const normalizedRubro = normalizeProductRubro(activeRubro);
  const getDefaults = useCallback(() => getProductFormDefaults({ activeRubro: normalizedRubro, capabilities, productToEdit }), [normalizedRubro, capabilities, productToEdit]);
  const [values, setValues] = useState(getDefaults);
  const [errors, setErrors] = useState({ fieldErrors: {}, globalErrors: [] });
  const [isSaving, setIsSaving] = useState(false);
  const blobUrlRef = useRef(null);

  useEffect(() => () => { if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current); }, []);
  const setField = useCallback((field, value) => setValues((previous) => ({ ...previous, [field]: value })), []);
  const setFields = useCallback((next) => setValues((previous) => ({ ...previous, ...next })), []);
  const setExpirationMode = useCallback((expirationMode) => setValues((previous) => ({ ...previous, expirationMode, ...(expirationMode === 'NONE' ? { expiryDate: '', shelfLifeValue: '', shelfLifeUnit: 'days', manufacturerBatchId: '' } : expirationMode === 'STRICT' ? { shelfLifeValue: '', shelfLifeUnit: 'days' } : { expiryDate: '', manufacturerBatchId: '' }) })), []);
  const setTrackStock = useCallback((trackStock) => setValues((previous) => ({ ...previous, trackStock, ...(trackStock ? {} : { expirationMode: 'NONE', expiryDate: '', shelfLifeValue: '', manufacturerBatchId: '' }) })), []);
  const changeRubro = useCallback((nextRubro) => { const defaults = getProductFormDefaults({ activeRubro: nextRubro, capabilities, productToEdit }); setValues((previous) => ({ ...defaults, ...previous, rubroContext: normalizeProductRubro(nextRubro), saleType: defaults.saleType, restaurantType: defaults.restaurantType, trackStock: productToEdit ? previous.trackStock : defaults.trackStock })); }, [capabilities, productToEdit]);
  const changeCost = useCallback((cost) => setValues((previous) => { const price = toNumber(previous.price); const parsedCost = toNumber(cost); return { ...previous, cost, margin: parsedCost > 0 && price > 0 ? (((price - parsedCost) / price) * 100).toFixed(1) : '' }; }), []);
  const changePrice = useCallback((price) => setValues((previous) => { const parsedPrice = toNumber(price); const cost = toNumber(previous.cost); return { ...previous, price, margin: cost > 0 && parsedPrice > 0 ? (((parsedPrice - cost) / parsedPrice) * 100).toFixed(1) : '' }; }), []);
  const changeMargin = useCallback((margin) => setValues((previous) => { const safeMargin = Math.min(toNumber(margin), 99.9); const cost = toNumber(previous.cost); return { ...previous, margin, price: cost > 0 ? (cost / (1 - safeMargin / 100)).toFixed(2) : previous.price }; }), []);
  const setImage = useCallback((file) => { if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = file ? URL.createObjectURL(file) : null; setFields({ image: file || null, imagePreview: blobUrlRef.current, imageUploadSource: file ? 'local' : null }); }, [setFields]);
  const payload = useMemo(() => buildProductFormPayload(values, { activeRubro: normalizedRubro, productToEdit }), [values, normalizedRubro, productToEdit]);
  const submit = useCallback(async ({ resetAfterSave = false } = {}) => { if (isSaving) return false; const nextErrors = validateProductForm(values, { activeRubro: normalizedRubro, isEditing: Boolean(productToEdit?.id) }); setErrors(nextErrors); if (nextErrors.globalErrors.length) return false; setIsSaving(true); try { const result = await onSave?.(payload, productToEdit || { id: payload.id, isNew: true }); if (result !== false && resetAfterSave && !productToEdit) { setValues(getDefaults()); setErrors({ fieldErrors: {}, globalErrors: [] }); } return result !== false; } finally { setIsSaving(false); } }, [getDefaults, isSaving, normalizedRubro, onSave, payload, productToEdit, values]);
  return { values, errors, isSaving, setField, setFields, setTrackStock, setExpirationMode, changeRubro, changeCost, changePrice, changeMargin, setImage, payload, submit };
}
