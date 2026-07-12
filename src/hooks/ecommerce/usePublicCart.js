import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Big from 'big.js';
import {
  getPublicProductMaxQuantity,
  isPublicProductAvailable
} from '../../services/ecommerce/ecommercePublicProductRules';

const CART_VERSION = 1;

const clampInteger = (value, minimum, maximum) => {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return minimum;
  return Math.min(maximum, Math.max(minimum, parsed));
};

const readStoredEntries = (storageKey) => {
  try {
    const rawValue = window.sessionStorage.getItem(storageKey);
    if (!rawValue) return [];
    const parsed = JSON.parse(rawValue);
    const rawItems = Array.isArray(parsed?.items) ? parsed.items : [];
    const entriesById = new Map();

    rawItems.forEach((item) => {
      const id = typeof item?.id === 'string' ? item.id : item?.productId;
      const quantity = Math.floor(Number(item?.quantity));
      if (!id || !Number.isFinite(quantity) || quantity <= 0 || entriesById.has(id)) return;
      entriesById.set(id, { id, quantity });
    });

    return Array.from(entriesById.values());
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
    entry.id !== after[index]?.id || entry.quantity !== after[index]?.quantity
  ))
);

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
    return entries.filter((entry) => !productMap.has(entry.id)).map((entry) => entry.id);
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
    setReconciledCatalogKey((current) => (
      current === reconciliationKey ? current : null
    ));
  }, [reconciliationKey, storageLoaded]);

  useEffect(() => {
    if (!catalogReady || !storageLoaded || isReconciled) return;
    if (!catalogExhausted && pendingProductIds.length > 0) return;

    const previousEntries = entriesRef.current;
    const reconciledEntries = previousEntries.reduce((nextEntries, entry) => {
      if (nextEntries.length >= safeMaxOrderItems) return nextEntries;
      const product = productMap.get(entry.id);
      if (!product || !isPublicProductAvailable(product)) return nextEntries;

      const effectiveMaximum = getPublicProductMaxQuantity(product, safeMaxItemQuantity);
      if (effectiveMaximum <= 0) return nextEntries;

      nextEntries.push({
        id: entry.id,
        quantity: clampInteger(entry.quantity, 1, effectiveMaximum)
      });
      return nextEntries;
    }, []);

    commitEntries(reconciledEntries);
    setReconciledCatalogKey(reconciliationKey);
    if (entriesChanged(previousEntries, reconciledEntries)) {
      setNotice('Actualizamos tu carrito con los precios y la disponibilidad vigentes.');
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
        items: entries.map(({ id, quantity }) => ({ id, quantity }))
      }));
    } catch {
      // La tienda sigue siendo utilizable aunque sessionStorage no esté disponible.
    }
  }, [entries, isReconciled, storageKey]);

  const cartItems = useMemo(() => entries.reduce((lines, entry) => {
    const product = productMap.get(entry.id);
    if (!product || !isPublicProductAvailable(product)) return lines;

    const effectiveMaximum = getPublicProductMaxQuantity(product, safeMaxItemQuantity);
    if (effectiveMaximum <= 0) return lines;
    const quantity = clampInteger(entry.quantity, 1, effectiveMaximum);

    let lineTotal = '0';
    try {
      lineTotal = new Big(product.price || 0).times(quantity).toFixed(2);
    } catch {
      lineTotal = '0';
    }

    lines.push({
      product,
      quantity,
      maxQuantity: effectiveMaximum,
      lineTotal
    });
    return lines;
  }, []), [entries, productMap, safeMaxItemQuantity]);

  const subtotalBig = useMemo(() => calculateMoney(cartItems), [cartItems]);
  const subtotal = subtotalBig.toFixed(2);
  const totalUnits = cartItems.reduce((total, line) => total + line.quantity, 0);
  const minimumBig = useMemo(() => {
    try {
      return new Big(Math.max(0, Number(minOrderTotal) || 0));
    } catch {
      return new Big(0);
    }
  }, [minOrderTotal]);
  const remaining = subtotalBig.gte(minimumBig) ? new Big(0) : minimumBig.minus(subtotalBig);

  const addProduct = useCallback((product) => {
    const effectiveMaximum = getPublicProductMaxQuantity(product, safeMaxItemQuantity);
    if (!product?.id || !isPublicProductAvailable(product) || effectiveMaximum <= 0) {
      setNotice('Este producto no está disponible por el momento.');
      return false;
    }

    const currentEntries = entriesRef.current;
    const existingIndex = currentEntries.findIndex((entry) => entry.id === product.id);
    if (existingIndex >= 0) {
      const existing = currentEntries[existingIndex];
      if (existing.quantity >= effectiveMaximum) {
        setNotice(getMaximumNotice(product, effectiveMaximum, safeMaxItemQuantity));
        return false;
      }

      const nextEntries = [...currentEntries];
      nextEntries[existingIndex] = { ...existing, quantity: existing.quantity + 1 };
      commitEntries(nextEntries);
      setNotice('Producto agregado al carrito.');
      return true;
    }

    if (currentEntries.length >= safeMaxOrderItems) {
      setNotice(`Puedes agregar hasta ${safeMaxOrderItems} productos distintos.`);
      return false;
    }

    commitEntries([...currentEntries, { id: product.id, quantity: 1 }]);
    setNotice('Producto agregado al carrito.');
    return true;
  }, [commitEntries, safeMaxItemQuantity, safeMaxOrderItems]);

  const setQuantity = useCallback((productId, quantity) => {
    const parsedQuantity = Math.floor(Number(quantity));
    const product = productMap.get(productId);
    const effectiveMaximum = getPublicProductMaxQuantity(product, safeMaxItemQuantity);

    if (!product || effectiveMaximum <= 0) return false;

    if (Number.isFinite(parsedQuantity) && parsedQuantity > effectiveMaximum) {
      setNotice(getMaximumNotice(product, effectiveMaximum, safeMaxItemQuantity));
    }

    const nextEntries = entriesRef.current.reduce((result, entry) => {
      if (entry.id !== productId) {
        result.push(entry);
      } else if (Number.isFinite(parsedQuantity) && parsedQuantity > 0) {
        result.push({
          ...entry,
          quantity: clampInteger(parsedQuantity, 1, effectiveMaximum)
        });
      }
      return result;
    }, []);
    commitEntries(nextEntries);
    return true;
  }, [commitEntries, productMap, safeMaxItemQuantity]);

  const increment = useCallback((productId) => {
    const current = entriesRef.current.find((entry) => entry.id === productId);
    const product = productMap.get(productId);
    if (!current || !product) return false;

    const effectiveMaximum = getPublicProductMaxQuantity(product, safeMaxItemQuantity);
    if (current.quantity >= effectiveMaximum) {
      setNotice(getMaximumNotice(product, effectiveMaximum, safeMaxItemQuantity));
      return false;
    }

    return setQuantity(productId, current.quantity + 1);
  }, [productMap, safeMaxItemQuantity, setQuantity]);

  const decrement = useCallback((productId) => {
    const current = entriesRef.current.find((entry) => entry.id === productId);
    if (!current) return;
    if (current.quantity <= 1) {
      commitEntries(entriesRef.current.filter((entry) => entry.id !== productId));
      return;
    }
    setQuantity(productId, current.quantity - 1);
  }, [commitEntries, setQuantity]);

  const removeProduct = useCallback((productId) => {
    commitEntries(entriesRef.current.filter((entry) => entry.id !== productId));
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
