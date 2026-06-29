import { useCallback, useEffect, useRef } from 'react';

const HISTORY_LAYER_KEY = '__lanzoDismissibleLayer';

const canUseWindowHistory = () => (
  typeof window !== 'undefined'
  && Boolean(window.history)
  && typeof window.history.pushState === 'function'
  && typeof window.history.back === 'function'
);

const stripLayerState = (state) => {
  if (!state || typeof state !== 'object') return {};
  const { [HISTORY_LAYER_KEY]: _layer, ...rest } = state;
  return rest;
};

/**
 * Convierte un modal/drawer visible en una capa compatible con el botón Atrás.
 *
 * Regla UX:
 * - Si la capa está abierta y el usuario presiona Atrás, se cierra la capa.
 * - Si la capa se cierra desde UI, se consume la entrada de historial creada para ella.
 * - Si no hay capa abierta, Atrás sigue navegando normalmente.
 */
export function useDismissibleHistoryLayer({
  isOpen,
  onDismiss,
  layerId = 'modal',
  enabled = true
}) {
  const onDismissRef = useRef(onDismiss);
  const layerTokenRef = useRef(null);
  const hasHistoryEntryRef = useRef(false);
  const pendingProgrammaticDismissRef = useRef(false);
  const fallbackTimerRef = useRef(null);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  const runDismiss = useCallback(() => {
    onDismissRef.current?.();
  }, []);

  useEffect(() => {
    if (!enabled || !isOpen || !canUseWindowHistory()) return undefined;

    const layerToken = `lanzo:${layerId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    layerTokenRef.current = layerToken;
    hasHistoryEntryRef.current = true;
    pendingProgrammaticDismissRef.current = false;

    const currentState = window.history.state && typeof window.history.state === 'object'
      ? window.history.state
      : {};

    window.history.pushState(
      {
        ...currentState,
        [HISTORY_LAYER_KEY]: layerToken
      },
      document.title,
      window.location.href
    );

    const handlePopState = () => {
      if (!hasHistoryEntryRef.current && !pendingProgrammaticDismissRef.current) return;

      hasHistoryEntryRef.current = false;
      pendingProgrammaticDismissRef.current = false;

      if (fallbackTimerRef.current) {
        window.clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }

      runDismiss();
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);

      if (fallbackTimerRef.current) {
        window.clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }

      if (
        hasHistoryEntryRef.current
        && window.history.state?.[HISTORY_LAYER_KEY] === layerTokenRef.current
        && typeof window.history.replaceState === 'function'
      ) {
        window.history.replaceState(stripLayerState(window.history.state), document.title, window.location.href);
      }

      hasHistoryEntryRef.current = false;
      pendingProgrammaticDismissRef.current = false;
    };
  }, [enabled, isOpen, layerId, runDismiss]);

  const dismiss = useCallback(() => {
    if (!canUseWindowHistory()) {
      runDismiss();
      return;
    }

    const currentLayerToken = window.history.state?.[HISTORY_LAYER_KEY];
    const ownsCurrentEntry = hasHistoryEntryRef.current && currentLayerToken === layerTokenRef.current;

    if (!ownsCurrentEntry) {
      runDismiss();
      return;
    }

    pendingProgrammaticDismissRef.current = true;
    window.history.back();

    // Fallback defensivo para entornos donde popstate no se emite de forma normal.
    fallbackTimerRef.current = window.setTimeout(() => {
      if (!pendingProgrammaticDismissRef.current) return;
      pendingProgrammaticDismissRef.current = false;
      hasHistoryEntryRef.current = false;
      fallbackTimerRef.current = null;
      runDismiss();
    }, 150);
  }, [runDismiss]);

  return dismiss;
}
