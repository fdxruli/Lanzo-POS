import { useCallback, useEffect, useRef, useState } from 'react';
import { queryActiveIngredientsForConfiguration } from '../../services/products/productCatalogQueryService';
import { subscribeProductCatalogEvents } from '../../services/products/productCatalogEvents';

export function useAvailableIngredients({ enabled = true } = {}) {
  const [ingredients, setIngredients] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!enabled) return [];
    setIsLoading(true);
    setError(null);
    try {
      const nextIngredients = await queryActiveIngredientsForConfiguration();
      if (mountedRef.current) setIngredients(nextIngredients);
      return nextIngredients;
    } catch (nextError) {
      if (mountedRef.current) setError(nextError);
      return [];
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) {
      setIngredients([]);
      setIsLoading(false);
      setError(null);
      return () => { mountedRef.current = false; };
    }
    refresh();
    const unsubscribe = subscribeProductCatalogEvents(() => { refresh(); });
    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, [enabled, refresh]);

  return { ingredients, isLoading, error, refresh };
}
