import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Big from 'big.js';
import {
  getPublicProductMaxQuantity,
  isPublicProductAvailable
} from '../../services/ecommerce/ecommercePublicProductRules';
import {
  buildEcommerceConfiguredLineKey,
  decodeEcommerceConfiguredLineKey
} from '../../utils/ecommerceConfiguredProduct';

const CART_VERSION = 2;

const clampInteger = (value, minimum, maximum) => {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return minimum;
  return Math.min(maximum, Math.max(minimum, parsed));
};
const asArray = (value) => (Array.isArray(value) ? value : []);
const asObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const asText = (value) => (typeof value === 'string' ? value.trim() : '');
const cloneJson = (value, fallback = null) => {
  try { return JSON.parse(JSON.stringify(value)); } catch { return fallback; }
};

const normalizeStoredEntry = (item) => {
  const source = asObject(item);
  const quantity = Math.floor(Number(source.quantity));
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  const legacyId = asText(source.id || source.productId);
  const decoded = decodeEcommerceConfiguredLineKey(source.lineKey || legacyId);
  if (!decoded) {
    if (!legacyId) return null;
    return { lineKey: legacyId, productId: legacyId, quantity };
  }

  const lineKey = buildEcommerceConfiguredLineKey(decoded);
  if (!lineKey) return null;
  return {
    lineKey,
    productId: decoded.productId,
    variantId: decoded.variantId,
    selections: decoded.selections,
    configurationVersion: Math.max(1, Math.floor(Number(source.configurationVersion) || 1)),
    configurationSnapshot: cloneJson(source.configurationSnapshot, {}),
    display: cloneJson(source.display, {}),
    estimatedUnitPrice: Math.max(0, Number(source.estimatedUnitPrice) || 0),
    maxQuantity: Math.max(1, Math.floor(Number(source.maxQuantity) || 99)),
    quantity
  };
};

const readStoredEntries = (storageKey) => {
  try {
    const rawValue = window.sessionStorage.getItem(storageKey);
    if (!rawValue) return [];
    const parsed = JSON.parse(rawValue);
    const rawItems = Array.isArray(parsed?.items) ? parsed.items : [];
    const entriesByKey = new Map();
    rawItems.forEach((item) => {
      const entry = normalizeStoredEntry(item);
      if (!entry) return;
      const current = entriesByKey.get(entry.lineKey);
      entriesByKey.set(entry.lineKey, current
        ? { ...current, quantity: current.quantity + entry.quantity }
        : entry);
    });
    return Array.from(entriesByKey.values());
  } catch {
    return [];
  }
};

export function getPublicCartStorageKey(slug) {
  return `lanzo:ecommerce:cart:${slug || 'unknown'}:v1`;
}

function calculateMoney(lines) {
  try {
    return lines.reduce((total, line) => (
      total.plus(new Big(line.product.price || 0).times(line.quantity))
    ), new Big(0));
  } catch {
    return new Big(0);
  }
}

function getMaximumNotice(product, effectiveMaximum, portalMaximum) {
  if (effectiveMaximum < portalMaximum && product?.stock?.mode === 'exact') {
    return `Solo hay ${effectiveMaximum} unidades disponibles para este producto.`;
  }
  return `La cantidad máxima por producto es ${effectiveMaximum}.`;
}

const entriesChanged = (before, after) => (
  before.length !== after.length
  || before.some((entry, index) => (
    entry.lineKey !== after[index]?.lineKey || entry.quantity !== after[index]?.quantity
  ))
);

const isConfiguredEntry = (entry) => Boolean(decodeEcommerceConfiguredLineKey(entry?.lineKey));

const getEntryMaximum = (entry, product, portalMaximum) => {
  const catalogMaximum = getPublicProductMaxQuantity(product, portalMaximum);
  if (!isConfiguredEntry(entry)) return catalogMaximum;
  return Math.max(0, Math.min(
    catalogMaximum,
    Math.max(1, Math.floor(Number(entry.maxQuantity) || portalMaximum))
  ));
};

const buildConfiguredProduct = (entry, product) => ({
  ...product,
  id: entry.lineKey,
  sourceProductId: product.id,
  price: Math.max(0, Number(entry.estimatedUnitPrice) || Number(product.price) || 0),
  imageUrl: entry.configurationSnapshot?.variant?.imageUrl || product.imageUrl,
  configurationLine: cloneJson(entry, {}),
  stock: {
    ...product.stock,
    mode: entry.maxQuantity < 99 ? 'exact' : product.stock?.mode,
    quantity: entry.maxQuantity < 99 ? entry.maxQuantity : product.stock?.quantity
  }
});

export default function usePublicCart({
  slug,
  products = [],
  catalogReady = false,
  catalogExhausted = false,
  catalogRevision = null,
  maxItemQuantity = 99,
  maxOrderItems = 30,
  minOrderTotal = 0
}) {
  const storageKey = useMemo(() => getPublicCartStorageKey(slug), [slug]);
  const reconciliationKey = useMemo(
    () => `${storageKey}:catalog:${catalogRevision || 'unversioned'}`,
    [catalogRevision, storageKey]
  );
  const [entries, setEntries] = useState([]);
  const entriesRef = useRef([]);
  const [loadedStorageKey, setLoadedStorageKey] = useState(null);
  const [reconciledCatalogKey, setReconciledCatalogKey] = useState(null);
  const [notice, setNotice] = useState('');

  const safeMaxItemQuantity = Math.max(1, Math.floor(Number(maxItemQuantity) || 99));
  const safeMaxOrderItems = Math.max(1, Math.floor(Number(maxOrderItems) || 30));
  const commitEntries = useCallback((nextEntries) => {
    entriesRef.current = nextEntries;
    setEntries(nextEntries);
  }, []);

  const productMap = useMemo(
    () => new Map(products.filter((product) => product?.id).map((product) => [product.id, product])),
    [products]
  );

  const storageLoaded = loadedStorageKey === storageKey;
  const isReconciled = reconciledCatalogKey === reconciliationKey;
  const pendingProductIds = useMemo(() => {
    if (!storageLoaded || isReconciled) return [];
    return Array.from(new Set(entries
      .filter((entry) => !productMap.has(entry.productId))
      .map((entry) => entry.productId)));
  }, [entries, isReconciled, productMap, storageLoaded]);
  const pendingProductIdsKey = pendingProductIds.join('|');

  useEffect(() => {
    commitEntries(readStoredEntries(storageKey));
    setLoadedStorageKey(storageKey);
    setReconciledCatalogKey(null);
    setNotice('');
  }, [commitEntries, storageKey]);

  useEffect(() => {
    if (!storageLoaded) return;
    setReconciledCatalogKey((current) => (current === reconciliationKey ? current : null));
  }, [reconciliationKey, storageLoaded]);

  useEffect(() => {
    if (!catalogReady || !storageLoaded || isReconciled) return;
    if (!catalogExhausted && pendingProductIds.length > 0) return;

    const previousEntries = entriesRef.current;
    const reconciledEntries = previousEntries.reduce((result, entry) => {
      if (result.length >= safeMaxOrderItems) return result;
      const product = productMap.get(entry.productId);
      if (!product || !isPublicProductAvailable(product)) return result;
      if (
        isConfiguredEntry(entry)
        && Number(entry.configurationVersion) !== Number(product.configuration?.version || 1)
      ) return result;

      const effectiveMaximum = getEntryMaximum(entry, product, safeMaxItemQuantity);
      if (effectiveMaximum <= 0) return result;
      result.push({
        ...entry,
        quantity: clampInteger(entry.quantity, 1, effectiveMaximum),
        maxQuantity: isConfiguredEntry(entry) ? effectiveMaximum : entry.maxQuantity
      });
      return result;
    }, []);

    commitEntries(reconciledEntries);
    setReconciledCatalogKey(reconciliationKey);
    if (entriesChanged(previousEntries, reconciledEntries)) {
      setNotice('Actualizamos tu carrito con los precios, opciones y disponibilidad vigentes.');
    }
  }, [
    catalogExhausted,
    catalogReady,
    commitEntries,
    isReconciled,
    pendingProductIds.length,
    pendingProductIdsKey,
    productMap,
    reconciliationKey,
    safeMaxItemQuantity,
    safeMaxOrderItems,
    storageLoaded
  ]);

  useEffect(() => {
    if (!isReconciled) return;
    try {
      if (entries.length === 0) {
        window.sessionStorage.removeItem(storageKey);
        return;
      }
      window.sessionStorage.setItem(storageKey, JSON.stringify({
        version: CART_VERSION,
        items: entries.map((entry) => (
          isConfiguredEntry(entry)
            ? {
                lineKey: entry.lineKey,
                productId: entry.productId,
                variantId: entry.variantId || null,
                selections: asArray(entry.selections),
                configurationVersion: entry.configurationVersion || null,
                configurationSnapshot: entry.configurationSnapshot || null,
                display: entry.display || null,
                estimatedUnitPrice: entry.estimatedUnitPrice,
                maxQuantity: entry.maxQuantity,
                quantity: entry.quantity
              }
            : { id: entry.productId, quantity: entry.quantity }
        ))
      }));
    } catch {
      // La tienda sigue siendo utilizable aunque sessionStorage no esté disponible.
    }
  }, [entries, isReconciled, storageKey]);

  const cartItems = useMemo(() => entries.reduce((lines, entry) => {
    const catalogProduct = productMap.get(entry.productId);
    if (!catalogProduct || !isPublicProductAvailable(catalogProduct)) return lines;
    const effectiveMaximum = getEntryMaximum(entry, catalogProduct, safeMaxItemQuantity);
    if (effectiveMaximum <= 0) return lines;
    const quantity = clampInteger(entry.quantity, 1, effectiveMaximum);
    const product = isConfiguredEntry(entry)
      ? buildConfiguredProduct(entry, catalogProduct)
      : catalogProduct;
    let lineTotal = '0';
    try { lineTotal = new Big(product.price || 0).times(quantity).toFixed(2); } catch { lineTotal = '0'; }
    lines.push({ product, quantity, maxQuantity: effectiveMaximum, lineTotal });
    return lines;
  }, []), [entries, productMap, safeMaxItemQuantity]);

  const subtotalBig = useMemo(() => calculateMoney(cartItems), [cartItems]);
  const subtotal = subtotalBig.toFixed(2);
  const totalUnits = cartItems.reduce((total, line) => total + line.quantity, 0);
  const minimumBig = useMemo(() => {
    try { return new Big(Math.max(0, Number(minOrderTotal) || 0)); } catch { return new Big(0); }
  }, [minOrderTotal]);
  const remaining = subtotalBig.gte(minimumBig) ? new Big(0) : minimumBig.minus(subtotalBig);

  const addProduct = useCallback((input, options = {}) => {
    const configured = input?.success === true && asText(input?.lineKey) && asText(input?.productId);
    const product = configured ? productMap.get(input.productId) : input;
    const lineKey = configured ? input.lineKey : product?.id;
    const replaceLineKey = asText(options.replaceLineKey);
    const requestedQuantity = configured ? Math.max(1, Math.floor(Number(input.quantity) || 1)) : 1;
    const entry = configured ? {
      lineKey,
      productId: input.productId,
      variantId: input.variantId || null,
      selections: cloneJson(input.selections, []),
      configurationVersion: input.configurationVersion,
      configurationSnapshot: cloneJson(input.configurationSnapshot, {}),
      display: cloneJson(input.display, {}),
      estimatedUnitPrice: Math.max(0, Number(input.estimatedUnitPrice) || 0),
      maxQuantity: Math.max(1, Math.floor(Number(input.maxQuantity) || safeMaxItemQuantity)),
      quantity: requestedQuantity
    } : { lineKey, productId: product?.id, quantity: requestedQuantity };

    const effectiveMaximum = getEntryMaximum(entry, product, safeMaxItemQuantity);
    if (!lineKey || !product?.id || !isPublicProductAvailable(product) || effectiveMaximum <= 0) {
      setNotice('Este producto no está disponible por el momento.');
      return false;
    }

    let nextEntries = entriesRef.current.filter((current) => current.lineKey !== replaceLineKey);
    const existingIndex = nextEntries.findIndex((current) => current.lineKey === lineKey);
    if (existingIndex >= 0) {
      const existing = nextEntries[existingIndex];
      const nextQuantity = Math.min(effectiveMaximum, existing.quantity + requestedQuantity);
      if (nextQuantity === existing.quantity) {
        setNotice(getMaximumNotice(product, effectiveMaximum, safeMaxItemQuantity));
        return false;
      }
      nextEntries = [...nextEntries];
      nextEntries[existingIndex] = { ...existing, ...entry, quantity: nextQuantity };
      commitEntries(nextEntries);
      setNotice(replaceLineKey ? 'Configuración actualizada.' : 'Producto agregado al carrito.');
      return true;
    }

    if (nextEntries.length >= safeMaxOrderItems) {
      setNotice(`Puedes agregar hasta ${safeMaxOrderItems} productos distintos.`);
      return false;
    }

    commitEntries([...nextEntries, { ...entry, quantity: Math.min(requestedQuantity, effectiveMaximum) }]);
    setNotice(replaceLineKey ? 'Configuración actualizada.' : 'Producto agregado al carrito.');
    return true;
  }, [commitEntries, productMap, safeMaxItemQuantity, safeMaxOrderItems]);

  const setQuantity = useCallback((lineKey, quantity) => {
    const parsedQuantity = Math.floor(Number(quantity));
    const current = entriesRef.current.find((entry) => entry.lineKey === lineKey);
    const product = current ? productMap.get(current.productId) : null;
    const effectiveMaximum = getEntryMaximum(current, product, safeMaxItemQuantity);
    if (!current || !product || effectiveMaximum <= 0) return false;
    if (Number.isFinite(parsedQuantity) && parsedQuantity > effectiveMaximum) {
      setNotice(getMaximumNotice(product, effectiveMaximum, safeMaxItemQuantity));
    }
    const nextEntries = entriesRef.current.reduce((result, entry) => {
      if (entry.lineKey !== lineKey) result.push(entry);
      else if (Number.isFinite(parsedQuantity) && parsedQuantity > 0) {
        result.push({ ...entry, quantity: clampInteger(parsedQuantity, 1, effectiveMaximum) });
      }
      return result;
    }, []);
    commitEntries(nextEntries);
    return true;
  }, [commitEntries, productMap, safeMaxItemQuantity]);

  const increment = useCallback((lineKey) => {
    const current = entriesRef.current.find((entry) => entry.lineKey === lineKey);
    const product = current ? productMap.get(current.productId) : null;
    if (!current || !product) return false;
    const effectiveMaximum = getEntryMaximum(current, product, safeMaxItemQuantity);
    if (current.quantity >= effectiveMaximum) {
      setNotice(getMaximumNotice(product, effectiveMaximum, safeMaxItemQuantity));
      return false;
    }
    return setQuantity(lineKey, current.quantity + 1);
  }, [productMap, safeMaxItemQuantity, setQuantity]);

  const decrement = useCallback((lineKey) => {
    const current = entriesRef.current.find((entry) => entry.lineKey === lineKey);
    if (!current) return;
    if (current.quantity <= 1) {
      commitEntries(entriesRef.current.filter((entry) => entry.lineKey !== lineKey));
      return;
    }
    setQuantity(lineKey, current.quantity - 1);
  }, [commitEntries, setQuantity]);

  const removeProduct = useCallback((lineKey) => {
    commitEntries(entriesRef.current.filter((entry) => entry.lineKey !== lineKey));
  }, [commitEntries]);
  const clearCart = useCallback(() => commitEntries([]), [commitEntries]);
  const clearNotice = useCallback(() => setNotice(''), []);

  return {
    items: cartItems,
    totalUnits,
    subtotal,
    currency: cartItems[0]?.product?.currency || 'MXN',
    minimumRemaining: remaining.toFixed(2),
    minimumReached: remaining.eq(0),
    notice,
    hasStoredEntries: storageLoaded && !isReconciled && entries.length > 0,
    pendingProductIds,
    isReconciled,
    addProduct,
    setQuantity,
    increment,
    decrement,
    removeProduct,
    clearCart,
    clearNotice
  };
}
