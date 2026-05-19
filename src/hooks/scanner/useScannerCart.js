// src/hooks/scanner/useScannerCart.js
import { useState, useCallback, useMemo } from 'react';

const buildLineId = (product) =>
  `${product.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const shouldAggregate = (product) =>
  product?.saleType !== 'bulk' || Boolean(product?.batchId) || Boolean(product?.isVariant);

const findItemIndex = (items, product) =>
  items.findIndex((item) => {
    if (product.isVariant && product.batchId) {
      return item.batchId === product.batchId;
    }
    if (product.batchId) {
      return item.id === product.id && item.batchId === product.batchId;
    }
    return item.id === product.id;
  });

export function useScannerCart() {
  const [items, setItems] = useState([]);
  const [unknownCodes, setUnknownCodes] = useState([]);
  const [isConfirming, setIsConfirming] = useState(false);

  const addItem = useCallback((product) => {
    setItems((prevItems) => {
      if (!shouldAggregate(product)) {
        // For non-aggregatable products (bulk without batch), always add as new line
        return [
          ...prevItems,
          {
            ...product,
            quantity: 1,
            uniqueLineId: buildLineId(product),
          },
        ];
      }

      const existingIndex = findItemIndex(prevItems, product);

      if (existingIndex === -1) {
        return [
          ...prevItems,
          {
            ...product,
            quantity: 1,
            uniqueLineId: buildLineId(product),
          },
        ];
      }

      // Increment quantity of existing item
      const newItems = [...prevItems];
      newItems[existingIndex] = {
        ...newItems[existingIndex],
        quantity: newItems[existingIndex].quantity + 1,
      };
      return newItems;
    });
  }, []);

  const addQuantity = useCallback((productInfo) => {
    if (isConfirming) return;

    const { quantity, uniqueLineId, ...baseProduct } = productInfo;

    setItems((prevItems) => {
      if (!shouldAggregate(baseProduct)) {
        return [
          ...prevItems,
          {
            ...baseProduct,
            quantity: 1,
            uniqueLineId: buildLineId(baseProduct),
          },
        ];
      }

      const existingIndex = findItemIndex(prevItems, baseProduct);

      if (existingIndex === -1) {
        return [
          ...prevItems,
          {
            ...baseProduct,
            quantity: 1,
            uniqueLineId: buildLineId(baseProduct),
          },
        ];
      }

      const newItems = [...prevItems];
      newItems[existingIndex] = {
        ...newItems[existingIndex],
        quantity: newItems[existingIndex].quantity + 1,
      };
      return newItems;
    });
  }, [isConfirming]);

  const removeQuantity = useCallback((productId, batchId = null) => {
    if (isConfirming) return;

    setItems((prevItems) => {
      const index = prevItems.findIndex((item) => {
        if (batchId) {
          return item.id === productId && item.batchId === batchId;
        }
        return item.id === productId;
      });

      if (index === -1) return prevItems;

      const item = prevItems[index];

      if (item.quantity <= 1) {
        // Remove item entirely
        return prevItems.filter((_, i) => i !== index);
      }

      // Decrement quantity
      const newItems = [...prevItems];
      newItems[index] = {
        ...item,
        quantity: item.quantity - 1,
      };
      return newItems;
    });
  }, [isConfirming]);

  const addUnknownCode = useCallback((code) => {
    setUnknownCodes((prev) => {
      const existing = prev.find((item) => item.code === code);
      if (existing) {
        return prev.map((item) =>
          item.code === code ? { ...item, attempts: item.attempts + 1 } : item
        );
      }
      return [...prev, { code, attempts: 1 }];
    });
  }, []);

  const clearUnknownCodes = useCallback(() => {
    setUnknownCodes([]);
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    setUnknownCodes([]);
    setIsConfirming(false);
  }, []);

  const total = useMemo(() => {
    return items.reduce((sum, item) => sum + (item.price || 0) * item.quantity, 0);
  }, [items]);

  const itemCount = useMemo(() => {
    return items.reduce((sum, item) => sum + item.quantity, 0);
  }, [items]);

  return {
    items,
    unknownCodes,
    total,
    itemCount,
    isConfirming,
    setIsConfirming,
    addItem,
    addQuantity,
    removeQuantity,
    addUnknownCode,
    clearUnknownCodes,
    clearCart,
  };
}
