import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getProductFormDefaults } from '../config/productFormDefaults';
import { normalizeProductRubro } from '../config/productRubroConfig';
import { buildProductFormPayload } from '../domain/buildProductFormPayload';
import { buildApparelVariantDelta, rebaseApparelVariantSnapshot } from '../domain/buildApparelVariantDelta';
import { normalizeProduceSaleConfiguration, toNumber } from '../domain/productFormNormalization';
import { calculateFractionedUnitCost, calculateSaleMargin } from '../domain/fractionedPricing';
import { validateProductForm } from '../domain/validateProductForm';
import { findLocalBarcodeConflicts } from '../../../../services/db/products';
import { normalizeBarcodeKey } from '../../../../services/products/productMapper';
import { getSaleTypeForIngredientUnit, normalizeIngredientUnit } from '../../../../utils/ingredientConfiguration';
import { compressImage, generateID } from '../../../../services/utils';
import { queryBatchesByProductIdAndActive } from '../../../../services/database';
import Logger from '../../../../services/Logger';

const PRODUCT_SAVE_UNCERTAIN_CODES = new Set([
  'PRODUCT_SAVE_RESULT_MISSING',
  'PRODUCT_SYNC_CONFIRMATION_MISSING',
  'PRODUCT_CATEGORY_CONFIRMATION_MISSING',
  'PRODUCT_CATEGORY_NOT_CONFIRMED'
]);

const getProductSaveCode = (result, fallback) => {
  const candidate = result?.code || result?.error?.code;
  return typeof candidate === 'string' && /^[A-Z0-9_]{1,64}$/.test(candidate)
    ? candidate
    : fallback;
};

const getProductSaveMessage = (result) => (
  (typeof result?.message === 'string' && result.message.trim())
  || (typeof result?.error?.message === 'string' && result.error.message.trim())
  || ''
);

const comparableValues = (values) => JSON.stringify(values, (_key, value) => {
  if (typeof File !== 'undefined' && value instanceof File) return `file:${value.name}:${value.size}:${value.lastModified}`;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return `blob:${value.size}:${value.type}`;
  return value;
});

export function useProductFormV2({ activeRubro, capabilities, productToEdit, initialDraftValues = null, onSave } = {}) {
  const normalizedRubro = normalizeProductRubro(activeRubro);
  const productCost = productToEdit?.cost;
  const productPrice = productToEdit?.price;
  const getDefaults = useCallback(() => {
    const defaults = getProductFormDefaults({ activeRubro: normalizedRubro, capabilities, productToEdit });
    return productToEdit?.id ? defaults : { ...defaults, id: defaults.id || generateID('prod') };
  }, [normalizedRubro, capabilities, productToEdit]);
  const initialDefaults = useMemo(getDefaults, [getDefaults]);
  const [values, setValues] = useState(() => (
    initialDraftValues ? { ...initialDefaults, ...initialDraftValues } : initialDefaults
  ));
  const [errors, setErrors] = useState({ fieldErrors: {}, globalErrors: [] });
  const [isSaving, setIsSaving] = useState(false);
  const [saveOutcome, setSaveOutcome] = useState(null);
  const submitInFlightRef = useRef(false);
  const [barcodeMatches, setBarcodeMatches] = useState([]);
  const [barcodeLookupFailed, setBarcodeLookupFailed] = useState(false);
  const [cloudBarcodeConflict, setCloudBarcodeConflict] = useState(false);
  const [rebasedProduct, setRebasedProduct] = useState(null);
  const blobUrlRef = useRef(null);
  const initialValuesRef = useRef(comparableValues(initialDefaults));
  const originalApparelBatchesRef = useRef([]);

  useEffect(() => { setSaveOutcome(null); }, [values]);

  useEffect(() => { setRebasedProduct(null); }, [productToEdit?.id]);

  const effectiveProductToEdit = rebasedProduct || productToEdit;

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
  useEffect(() => {
    const key = normalizeBarcodeKey(values.barcode);
    const unchanged = productToEdit?.id && key === normalizeBarcodeKey(productToEdit.barcode);
    if (!key || unchanged) {
      setBarcodeMatches([]);
      setBarcodeLookupFailed(false);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      findLocalBarcodeConflicts(key, productToEdit?.id || null).then((matches) => {
        if (cancelled) return;
        setBarcodeMatches(matches);
        setBarcodeLookupFailed(false);
      }).catch(() => {
        if (cancelled) return;
        setBarcodeMatches([]);
        setBarcodeLookupFailed(true);
      });
    }, 220);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [values.barcode, productToEdit?.id, productToEdit?.barcode]);

  const setField = useCallback((field, value) => {
    setValues((previous) => ({ ...previous, [field]: value }));
    if (field === 'barcode') {
      setCloudBarcodeConflict(false);
      setErrors((previous) => {
        const fieldErrors = { ...previous.fieldErrors };
        delete fieldErrors.barcode;
        return { ...previous, fieldErrors };
      });
    }
  }, []);
  const setFields = useCallback((next) => setValues((previous) => ({ ...previous, ...next })), []);
  const setSaleMode = useCallback((saleMode) => setValues((previous) => {
    const nextSaleMode = saleMode === 'bulk' ? 'bulk' : (saleMode === 'fractioned' ? 'fractioned' : 'unit');
    const currentUnit = previous.unit || 'pza';
    const unit = nextSaleMode === 'bulk' && currentUnit === 'pza'
      ? 'kg'
      : ((nextSaleMode === 'unit' || nextSaleMode === 'fractioned') && previous.saleMode === 'bulk' ? 'pza' : currentUnit);
    return {
      ...previous,
      saleMode: nextSaleMode,
      saleType: nextSaleMode === 'bulk' ? 'bulk' : 'unit',
      unit,
      conversionFactor: { ...previous.conversionFactor, enabled: nextSaleMode === 'fractioned' }
    };
  }), []);
  const setProduceSaleMode = useCallback((saleMode) => setValues((previous) => ({
    ...previous,
    ...normalizeProduceSaleConfiguration({ saleMode, saleType: saleMode, unit: previous.unit }),
    conversionFactor: { ...previous.conversionFactor, enabled: false }
  })), []);
  const setRestaurantType = useCallback((restaurantType) => setValues((previous) => {
    const isIngredient = restaurantType === 'ingredient';
    const ingredientUnit = normalizeIngredientUnit(previous.unit);
    return {
      ...previous,
      restaurantType,
      productType: isIngredient ? 'ingredient' : 'sellable',
      price: isIngredient ? 0 : previous.price,
      margin: isIngredient ? '' : previous.margin,
      unit: isIngredient ? ingredientUnit : previous.unit,
      saleType: isIngredient ? getSaleTypeForIngredientUnit(ingredientUnit) : previous.saleType,
      trackStock: restaurantType === 'dish' ? false : (isIngredient ? true : previous.trackStock)
    };
  }), []);
  const setBatchSummary = useCallback((batchSummary) => setValues((previous) => ({
    ...previous,
    batchSummary,
    supplier: previous.supplier || batchSummary?.supplier || ''
  })), []);
  const setExpirationMode = useCallback((expirationMode) => setValues((previous) => ({ ...previous, expirationMode, ...(expirationMode === 'NONE' ? { expiryDate: '', shelfLifeValue: '', shelfLifeUnit: 'days', manufacturerBatchId: '' } : expirationMode === 'STRICT' ? { shelfLifeValue: '', shelfLifeUnit: 'days' } : { expiryDate: '', manufacturerBatchId: '' }) })), []);
  const setTrackStock = useCallback((trackStock) => setValues((previous) => ({ ...previous, trackStock, ...(trackStock ? {} : { expirationMode: 'NONE', expiryDate: '', shelfLifeValue: '', manufacturerBatchId: '' }) })), []);
  useEffect(() => {
    const purchaseCost = values.conversionFactor?.purchaseCost;
    const factor = values.conversionFactor?.factor;
    if (values.saleMode !== 'fractioned') return;
    const unitCost = calculateFractionedUnitCost({ purchaseCost, factor });
    if (unitCost <= 0) return;
    setValues((previous) => {
      const margin = calculateSaleMargin({ cost: unitCost, price: previous.price });
      const nextMargin = margin > 0 ? margin.toFixed(1) : '';
      if (toNumber(previous.cost) === unitCost && previous.margin === nextMargin) return previous;
      return { ...previous, cost: unitCost, margin: nextMargin };
    });
  }, [values.conversionFactor?.factor, values.conversionFactor?.purchaseCost, values.price, values.saleMode]);
  const changeRubro = useCallback((nextRubro) => {
    const nextNormalizedRubro = normalizeProductRubro(nextRubro);
    const defaults = getProductFormDefaults({ activeRubro: nextNormalizedRubro, capabilities, productToEdit });
    setValues((previous) => ({
      ...defaults,
      ...previous,
      rubroContext: nextNormalizedRubro,
      saleMode: nextNormalizedRubro === 'verduleria/fruteria' ? defaults.saleMode : previous.saleMode,
      saleType: defaults.saleType,
      unit: nextNormalizedRubro === 'verduleria/fruteria' ? defaults.unit : previous.unit,
      restaurantType: defaults.restaurantType,
      trackStock: productToEdit ? previous.trackStock : defaults.trackStock
    }));
  }, [capabilities, productToEdit]);
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
    const next = buildProductFormPayload(values, { activeRubro: normalizedRubro, productToEdit: effectiveProductToEdit });
    if (normalizedRubro === 'apparel' && effectiveProductToEdit?.id) {
      next.apparelVariantDelta = buildApparelVariantDelta(originalApparelBatchesRef.current, next.quickVariants);
    }
    return next;
  }, [values, normalizedRubro, effectiveProductToEdit]);
  const isDirty = comparableValues(values) !== initialValuesRef.current;
  const markClean = useCallback((nextValues) => { initialValuesRef.current = comparableValues(nextValues); }, []);
  const submit = useCallback(async ({ resetAfterSave = false } = {}) => {
    if (isSaving || submitInFlightRef.current) return false;
    submitInFlightRef.current = true;
    try {
      const nextErrors = validateProductForm(values, { activeRubro: normalizedRubro, isEditing: Boolean(productToEdit?.id), productToEdit });
      setErrors(nextErrors);
      if (nextErrors.globalErrors.length) return false;
      const unchanged = productToEdit?.id
        && normalizeBarcodeKey(payload.barcode) === normalizeBarcodeKey(productToEdit.barcode);
      try {
        const matches = (!normalizeBarcodeKey(payload.barcode) || unchanged)
          ? []
          : await findLocalBarcodeConflicts(payload.barcode, productToEdit?.id || null);
        setBarcodeMatches(matches);
        setBarcodeLookupFailed(false);
        if (matches.length) {
          setErrors({ ...nextErrors, fieldErrors: { ...nextErrors.fieldErrors, barcode: 'Este código ya pertenece a otro producto.' } });
          return false;
        }
      } catch {
        setBarcodeLookupFailed(true);
        setErrors({ ...nextErrors, fieldErrors: { ...nextErrors.fieldErrors, barcode: 'No se pudo comprobar el código localmente. Inténtalo de nuevo.' } });
        return false;
      }
      setSaveOutcome(null);
      setIsSaving(true);
      try {
        const options = { intent: resetAfterSave ? 'save_and_add_another' : 'save', keepFormOpen: resetAfterSave, source: 'product-form-v2' };
        const result = await onSave?.(payload, effectiveProductToEdit || { id: payload.id, isNew: true }, options);
        if (result?.success === false && ['APPAREL_DUPLICATE_SKU', 'APPAREL_SKU_CHECK_FAILED', 'DUPLICATE_SKU'].includes(result.code)) {
          Logger.warn('[Products] Guardado V2 rechazado por SKU.', {
            stage: 'form_on_save_result',
            code: getProductSaveCode(result, 'PRODUCT_VARIANT_SKU_REJECTED')
          });
          setErrors((previous) => ({
            ...previous,
            fieldErrors: { ...previous.fieldErrors, quickVariants: result.message || 'No se pudo guardar el SKU de la variante.' }
          }));
          return false;
        }
        if (result?.success === false && ['DUPLICATE_BARCODE', 'DUPLICATE_PRODUCT_KEY'].includes(result.code || result.error?.code)) {
          const code = result.code || result.error?.code;
          Logger.warn('[Products] Guardado V2 rechazado por código duplicado.', {
            stage: 'form_on_save_result',
            code: getProductSaveCode(result, 'DUPLICATE_PRODUCT_KEY')
          });
          if (code === 'DUPLICATE_PRODUCT_KEY' && normalizedRubro === 'apparel' && values.hasVariants) {
            setErrors((previous) => ({
              ...previous,
              fieldErrors: {
                ...previous.fieldErrors,
                ...(payload.barcode ? { barcode: 'Cloud detectó un código de barras o SKU duplicado.' } : {}),
                quickVariants: result.message || 'Cloud detectó un SKU duplicado entre las variantes.'
              }
            }));
            return false;
          }
          const matches = await findLocalBarcodeConflicts(payload.barcode, productToEdit?.id || null).catch(() => []);
          setBarcodeMatches(matches);
          setCloudBarcodeConflict(matches.length === 0);
          setErrors((previous) => ({
            ...previous,
            fieldErrors: { ...previous.fieldErrors, barcode: 'Este código de barras ya está registrado.' }
          }));
          return false;
        }
        if (result?.cancelled) {
          setSaveOutcome({
            kind: 'cancelled',
            message: result.message || 'Guardado cancelado. Conservamos los cambios del formulario.'
          });
          return false;
        }
        if (result?.partial) {
          originalApparelBatchesRef.current = rebaseApparelVariantSnapshot(
            originalApparelBatchesRef.current,
            values.quickVariants,
            result.appliedVariants
          );
          const cloudProduct = result.productRebase || {};
          const cloudVersion = cloudProduct.serverVersion ?? cloudProduct.server_version;
          if (cloudVersion !== null && cloudVersion !== undefined) {
            setRebasedProduct({ ...effectiveProductToEdit, serverVersion: cloudVersion });
          }
          if (!result.errorPresented) {
            setSaveOutcome({
              kind: 'warning',
              message: getProductSaveMessage(result) || 'El producto se guardó parcialmente. Conservamos el borrador para que puedas revisar los cambios pendientes.'
            });
          }
          return result;
        }
        if (result?.errorPresented) return false;
        if (result?.success === false) {
          const code = getProductSaveCode(result, 'PRODUCT_SAVE_REJECTED_UNREPORTED');
          const uncertain = PRODUCT_SAVE_UNCERTAIN_CODES.has(code);
          Logger.warn('[Products] Guardado V2 rechazado sin mensaje previo.', {
            stage: 'form_on_save_result',
            code
          });
          setSaveOutcome({
            kind: uncertain ? 'warning' : 'error',
            message: uncertain
              ? `Cloud no confirmó el resultado. Conservamos el borrador; verifica el catálogo antes de volver a guardar. Código: ${code}.`
              : getProductSaveMessage(result) || `No se confirmó el guardado. Conservamos el borrador. Código: ${code}.`
          });
          return false;
        }
        const confirmedSave = result === true || result?.success === true;
        if (!confirmedSave) {
          const resultMissing = result === null || result === undefined;
          const code = resultMissing
            ? 'PRODUCT_SAVE_RESULT_MISSING'
            : getProductSaveCode(result, 'PRODUCT_SAVE_RESULT_UNRECOGNIZED');
          const uncertain = resultMissing
            || result?.success !== false
            || PRODUCT_SAVE_UNCERTAIN_CODES.has(code);
          const resultReason = uncertain && !PRODUCT_SAVE_UNCERTAIN_CODES.has(code)
            ? getProductSaveMessage(result)
            : '';
          Logger.warn('[Products] Guardado V2 sin confirmación reconocida.', {
            stage: resultMissing ? 'form_on_save_result' : 'form_save_result_validation',
            code
          });
          setSaveOutcome({
            kind: uncertain ? 'warning' : 'error',
            message: uncertain
              ? `${resultReason ? `${resultReason} ` : ''}No recibimos confirmación del guardado. Conservamos el borrador; verifica el catálogo antes de volver a guardar. Código: ${code}.`
              : getProductSaveMessage(result) || `No se confirmó el guardado. Conservamos el borrador. Código: ${code}.`
          });
          return false;
        }
        if (normalizedRubro === 'apparel' && effectiveProductToEdit?.id && result?.appliedVariants) {
          const rebasedVariants = rebaseApparelVariantSnapshot(
            originalApparelBatchesRef.current,
            values.quickVariants,
            result.appliedVariants
          );
          originalApparelBatchesRef.current = rebasedVariants.map((variant) => ({ ...variant }));
          const nextValues = { ...values, quickVariants: rebasedVariants };
          setValues(nextValues);
          markClean(nextValues);
          if (!result.messageHandled) {
            setSaveOutcome({
              kind: result.pending ? 'warning' : 'success',
              message: getProductSaveMessage(result) || (result.pending
                ? 'Producto guardado localmente. La sincronización sigue pendiente.'
                : 'Producto guardado.')
            });
          }
          return result;
        }
        if (resetAfterSave && !productToEdit) {
          const next = getDefaults();
          setValues(next);
          markClean(next);
          setErrors({ fieldErrors: {}, globalErrors: [] });
        } else {
          markClean(values);
        }
        if (!resetAfterSave && !result?.messageHandled) {
          setSaveOutcome({
            kind: result?.pending ? 'warning' : 'success',
            message: getProductSaveMessage(result) || (result?.pending
              ? 'Producto guardado localmente. La sincronización sigue pendiente.'
              : 'Producto guardado.')
          });
        }
        return result;
      } catch (error) {
        const code = getProductSaveCode(error, 'PRODUCT_SAVE_CALLBACK_THROWN');
        Logger.warn('[Products] La respuesta del guardado V2 no pudo completarse.', {
          stage: 'form_on_save_exception',
          code
        });
        setSaveOutcome({
          kind: 'warning',
          message: `No pudimos confirmar el resultado del guardado. Conservamos el borrador; verifica el catálogo antes de volver a guardar. Código: ${code}.`
        });
        return false;
      } finally { setIsSaving(false); }
    } finally {
      submitInFlightRef.current = false;
    }
  }, [effectiveProductToEdit, getDefaults, isSaving, markClean, normalizedRubro, onSave, payload, productToEdit, values]);
  return { values, errors, isSaving, isDirty, saveOutcome, barcodeMatches, barcodeLookupFailed, cloudBarcodeConflict, setField, setFields, setSaleMode, setProduceSaleMode, setRestaurantType, setBatchSummary, setTrackStock, setExpirationMode, changeRubro, changeCost, changePrice, changeMargin, setImage, payload, submit };
}
