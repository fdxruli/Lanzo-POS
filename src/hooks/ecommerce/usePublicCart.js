import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Big from 'big.js';

const CART_VERSION = 1;

const clampInteger = (value, minimum, maximum) => {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return minimum;
  return Math.min(maximum, Math.max(minimum, parsed));
};

const isProductAvailable = (product) => (
  product?.isAvailable !== false && product?.stock?.status !== 'out_of_stock'
);

const readStoredEntries = (storageKey) => {
  try {
    const rawValue = window.sessionStorage.getItem(storageKey);
    if (!rawValue) return [];
    const parsed = JSON.parse(rawValue);
    const rawItems = Array.isArray(parsed?.items) ? parsed.items : [];

    return rawItems.map((item) => ({
      id: typeof item?.id === 'string' ? item.id : item?.productId,
      quantity: Math.floor(Number(item?.quantity)),
    })).filter((item) => item.id && Number.isFinite(item.quantity) && item.quantity > 0);
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

export default function usePublicCart({
  slug,
  products = [],
  catalogReady = false,
  maxItemQuantity = 99,
  maxOrderItems = 30,
  minOrderTotal = 0,
}) {
  const storageKey = useMemo(() => getPublicCartStorageKey(slug), [slug]);
  const [entries, setEntries] = useState([]);
  const entriesRef = useRef([]);
  const [loadedStorageKey, setLoadedStorageKey] = useState(null);
  const [reconciledStorageKey, setReconciledStorageKey] = useState(null);
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

  useEffect(() => {
    commitEntries(readStoredEntries(storageKey));
    setLoadedStorageKey(storageKey);
    setReconciledStorageKey(null);
    setNotice('');
  }, [commitEntries, storageKey]);

  useEffect(() => {
    if (!catalogReady || loadedStorageKey !== storageKey) return;

    const reconciledEntries = entriesRef.current.reduce((nextEntries, entry) => {
      if (nextEntries.length >= safeMaxOrderItems) return nextEntries;
      const product = productMap.get(entry.id);
      if (!product || !isProductAvailable(product)) return nextEntries;

      nextEntries.push({
        id: entry.id,
        quantity: clampInteger(entry.quantity, 1, safeMaxItemQuantity),
      });
      return nextEntries;
    }, []);
    commitEntries(reconciledEntries);
    setReconciledStorageKey(storageKey);
  }, [catalogReady, commitEntries, loadedStorageKey, productMap, safeMaxItemQuantity, safeMaxOrderItems, storageKey]);

  useEffect(() => {
    if (reconciledStorageKey !== storageKey) return;

    try {
      if (entries.length === 0) {
        window.sessionStorage.removeItem(storageKey);
        return;
      }

      window.sessionStorage.setItem(storageKey, JSON.stringify({
        version: CART_VERSION,
        items: entries.map(({ id, quantity }) => ({ id, quantity })),
      }));
    } catch {
      // La tienda sigue siendo utilizable aunque sessionStorage no esté disponible.
    }
  }, [entries, reconciledStorageKey, storageKey]);

  const cartItems = useMemo(() => entries.reduce((lines, entry) => {
    const product = productMap.get(entry.id);
    if (!product || !isProductAvailable(product)) return lines;

    let lineTotal = '0';
    try {
      lineTotal = new Big(product.price || 0).times(entry.quantity).toFixed(2);
    } catch {
      lineTotal = '0';
    }

    lines.push({ product, quantity: entry.quantity, lineTotal });
    return lines;
  }, []), [entries, productMap]);

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
    if (!product?.id || !isProductAvailable(product)) {
      setNotice('Este producto no está disponible por el momento.');
      return false;
    }

    const currentEntries = entriesRef.current;
    const existingIndex = currentEntries.findIndex((entry) => entry.id === product.id);
    if (existingIndex >= 0) {
      const existing = currentEntries[existingIndex];
      if (existing.quantity >= safeMaxItemQuantity) {
        setNotice(`La cantidad máxima por producto es ${safeMaxItemQuantity}.`);
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
    const nextEntries = entriesRef.current.reduce((result, entry) => {
      if (entry.id !== productId) {
        result.push(entry);
      } else if (Number.isFinite(parsedQuantity) && parsedQuantity > 0) {
        result.push({
          ...entry,
          quantity: clampInteger(parsedQuantity, 1, safeMaxItemQuantity),
        });
      }
      return result;
    }, []);
    commitEntries(nextEntries);
  }, [commitEntries, safeMaxItemQuantity]);

  const increment = useCallback((productId) => {
    const current = entriesRef.current.find((entry) => entry.id === productId);
    if (!current) return;
    setQuantity(productId, current.quantity + 1);
  }, [setQuantity]);

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
    addProduct,
    setQuantity,
    increment,
    decrement,
    removeProduct,
    clearCart,
    clearNotice,
  };
}
