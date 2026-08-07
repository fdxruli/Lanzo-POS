import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getProductFormDefaults } from '../config/productFormDefaults';
import { normalizeProductRubro } from '../config/productRubroConfig';
import { buildProductFormPayload } from '../domain/buildProductFormPayload';
import { buildApparelVariantDelta } from '../domain/buildApparelVariantDelta';
import { toNumber } from '../domain/productFormNormalization';
import { validateProductForm } from '../domain/validateProductForm';
import { compressImage, generateID } from '../../../../services/utils';
import { queryBatchesByProductIdAndActive } from '../../../../services/database';

const comparableValues = (values) => JSON.stringify(values, (_key, value) => {
  if (typeof File !== 'undefined' && value instanceof File) return `file:${value.name}:${value.size}:${value.lastModified}`;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return `blob:${value.size}:${value.type}`;
  return value;
});

export function useProductFormV2({ activeRubro, capabilities, productToEdit, onSave } = {}) {
  const normalizedRubro = normalizeProductRubro(activeRubro);
  const productCost = productToEdit?.cost;
  const productPrice = productToEdit?.price;
  const getDefaults = useCallback(() => {
    const defaults = getProductFormDefaults({ activeRubro: normalizedRubro, capabilities, productToEdit });
    return productToEdit?.id ? defaults : { ...defaults, id: defaults.id || generateID('prod') };
  }, [normalizedRubro, capabilities, productToEdit]);
  const [values, setValues] = useState(getDefaults);
  const [errors, setErrors] = useState({ fieldErrors: {}, globalErrors: [] });
  const [isSaving, setIsSaving] = useState(false);
  const blobUrlRef = useRef(null);
  const initialValuesRef = useRef(comparableValues(values));
  const originalApparelBatchesRef = useRef([]);

  useEffect(() => {
    originalApparelBatchesRef.current = [];
    if (!productToEdit?.id || normalizedRubro !== 'apparel') return undefined;
    let cancelled = false;
    queryBatchesByProductIdAndActive(productToEdit.id)
      .then((batches) => {
        if (cancelled || !Array.isArray(batches)) return;
        const quickVariants = batches
          .filter((batch) => batch.attributes?.talla || batch.attributes?.color)
          .map((batch) => ({
            id: batch.id,
            serverVersion: batch.serverVersion,
            createdAt: batch.createdAt,
            syncStatus: batch.syncStatus,
            lastSyncedAt: batch.lastSyncedAt,
            isExistingVariant: true,
            talla: batch.attributes?.talla || '', color: batch.attributes?.color || '', sku: batch.sku || '',
            stock: batch.stock ?? 0, cost: batch.cost ?? productCost ?? 0, price: batch.price ?? productPrice ?? 0
          }));
        originalApparelBatchesRef.current = quickVariants.map((variant) => ({ ...variant }));
        if (!quickVariants.length) return;
        setValues((previous) => {
          const next = { ...previous, hasVariants: true, quickVariants };
          initialValuesRef.current = comparableValues(next);
          return next;
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [normalizedRubro, productCost, productPrice, productToEdit?.id]);

  useEffect(() => () => { if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current); }, []);
  const setField = useCallback((field, value) => setValues((previous) => ({ ...previous, [field]: value })), []);
  const setFields = useCallback((next) => setValues((previous) => ({ ...previous, ...next })), []);
  const setExpirationMode = useCallback((expirationMode) => setValues((previous) => ({ ...previous, expirationMode, ...(expirationMode === 'NONE' ? { expiryDate: '', shelfLifeValue: '', shelfLifeUnit: 'days', manufacturerBatchId: '' } : expirationMode === 'STRICT' ? { shelfLifeValue: '', shelfLifeUnit: 'days' } : { expiryDate: '', manufacturerBatchId: '' }) })), []);
  const setTrackStock = useCallback((trackStock) => setValues((previous) => ({ ...previous, trackStock, ...(trackStock ? {} : { expirationMode: 'NONE', expiryDate: '', shelfLifeValue: '', manufacturerBatchId: '' }) })), []);
  const changeRubro = useCallback((nextRubro) => { const defaults = getProductFormDefaults({ activeRubro: nextRubro, capabilities, productToEdit }); setValues((previous) => ({ ...defaults, ...previous, rubroContext: normalizeProductRubro(nextRubro), saleType: defaults.saleType, restaurantType: defaults.restaurantType, trackStock: productToEdit ? previous.trackStock : defaults.trackStock })); }, [capabilities, productToEdit]);
  const changeCost = useCallback((cost) => setValues((previous) => { const price = toNumber(previous.price); const parsedCost = toNumber(cost); return { ...previous, cost, margin: parsedCost > 0 && price > 0 ? (((price - parsedCost) / price) * 100).toFixed(1) : '' }; }), []);
  const changePrice = useCallback((price) => setValues((previous) => { const parsedPrice = toNumber(price); const cost = toNumber(previous.cost); return { ...previous, price, margin: cost > 0 && parsedPrice > 0 ? (((parsedPrice - cost) / parsedPrice) * 100).toFixed(1) : '' }; }), []);
  const changeMargin = useCallback((margin) => setValues((previous) => { const safeMargin = Math.min(toNumber(margin), 99.9); const cost = toNumber(previous.cost); return { ...previous, margin, price: cost > 0 ? (cost / (1 - safeMargin / 100)).toFixed(2) : previous.price }; }), []);
  const setImage = useCallback(async (file) => {
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    if (!file) {
      blobUrlRef.current = null;
      setFields({ image: null, imagePreview: null, imageUploadSource: null, imageRemoved: true });
      return;
    }
    const compressed = await compressImage(file);
    blobUrlRef.current = URL.createObjectURL(compressed);
    // The compressed copy is retained locally; cloud publication always receives
    // the original file so prepareProductImageForCloud can preserve its contract.
    setFields({ image: compressed, imagePreview: blobUrlRef.current, imageUploadSource: file, imageRemoved: false });
  }, [setFields]);
  const payload = useMemo(() => {
    const next = buildProductFormPayload(values, { activeRubro: normalizedRubro, productToEdit });
    if (normalizedRubro === 'apparel' && productToEdit?.id) {
      next.apparelVariantDelta = buildApparelVariantDelta(originalApparelBatchesRef.current, next.quickVariants);
    }
    return next;
  }, [values, normalizedRubro, productToEdit]);
  const isDirty = comparableValues(values) !== initialValuesRef.current;
  const markClean = useCallback((nextValues) => { initialValuesRef.current = comparableValues(nextValues); }, []);
  const submit = useCallback(async ({ resetAfterSave = false } = {}) => {
    if (isSaving) return false;
    const nextErrors = validateProductForm(values, { activeRubro: normalizedRubro, isEditing: Boolean(productToEdit?.id) });
    setErrors(nextErrors);
    if (nextErrors.globalErrors.length) return false;
    setIsSaving(true);
    try {
      const options = { intent: resetAfterSave ? 'save_and_add_another' : 'save', keepFormOpen: resetAfterSave, source: 'product-form-v2' };
      const result = await onSave?.(payload, productToEdit || { id: payload.id, isNew: true }, options);
      if (result !== false && resetAfterSave && !productToEdit) {
        const next = getDefaults();
        setValues(next);
        markClean(next);
        setErrors({ fieldErrors: {}, globalErrors: [] });
      } else if (result !== false) {
        markClean(values);
      }
      return result;
    } finally { setIsSaving(false); }
  }, [getDefaults, isSaving, markClean, normalizedRubro, onSave, payload, productToEdit, values]);
  return { values, errors, isSaving, isDirty, setField, setFields, setTrackStock, setExpirationMode, changeRubro, changeCost, changePrice, changeMargin, setImage, payload, submit };
}
