import { useCallback, useEffect, useRef } from 'react';

const HISTORY_LAYER_KEY = '__lanzoDismissibleLayer';
const HISTORY_HANDOFF_RECOVERY_MS = 1000;
const MAX_INVALIDATED_LAYER_TOKENS = 64;

const activeLayerTokens = new Set();
const invalidatedLayerTokens = new Set();
const invalidatedLayerTokenQueue = [];

let pendingHistoryLayerHandoff = null;
let mountedHistoryLayerHooks = 0;
let globalRecoveryListener = null;

const canUseWindowHistory = () => (
  typeof window !== 'undefined'
  && Boolean(window.history)
  && typeof window.history.pushState === 'function'
  && typeof window.history.back === 'function'
);

const getHistoryTitle = () => (
  typeof document === 'undefined' ? '' : document.title
);

const stripLayerState = (state) => {
  if (!state || typeof state !== 'object') return {};
  const { [HISTORY_LAYER_KEY]: _layer, ...rest } = state;
  return rest;
};

const createLayerToken = (layerId) => (
  `lanzo:${layerId}:${Date.now()}:${Math.random().toString(36).slice(2)}`
);

const rememberInvalidatedLayerToken = (token) => {
  if (!token || invalidatedLayerTokens.has(token)) return;

  invalidatedLayerTokens.add(token);
  invalidatedLayerTokenQueue.push(token);

  while (invalidatedLayerTokenQueue.length > MAX_INVALIDATED_LAYER_TOKENS) {
    const oldestToken = invalidatedLayerTokenQueue.shift();
    invalidatedLayerTokens.delete(oldestToken);
  }
};

const replaceCurrentLayerToken = (token) => {
  const currentState = window.history.state && typeof window.history.state === 'object'
    ? window.history.state
    : {};

  window.history.replaceState(
    {
      ...stripLayerState(currentState),
      [HISTORY_LAYER_KEY]: token
    },
    getHistoryTitle(),
    window.location.href
  );
};

const stripCurrentLayerToken = (expectedToken = null) => {
  if (typeof window.history.replaceState !== 'function') return false;

  const currentToken = window.history.state?.[HISTORY_LAYER_KEY];
  if (expectedToken && currentToken !== expectedToken) return false;
  if (!currentToken) return false;

  window.history.replaceState(
    stripLayerState(window.history.state),
    getHistoryTitle(),
    window.location.href
  );
  return true;
};

const recoverInvalidatedCurrentEntry = (state = window.history.state) => {
  const token = state?.[HISTORY_LAYER_KEY];
  if (
    !token
    || !invalidatedLayerTokens.has(token)
    || activeLayerTokens.has(token)
    || window.history.state?.[HISTORY_LAYER_KEY] !== token
  ) {
    return false;
  }

  const recovered = stripCurrentLayerToken(token);
  if (recovered) invalidatedLayerTokens.delete(token);
  return recovered;
};

const retainGlobalRecoveryListener = () => {
  if (!canUseWindowHistory()) return;

  mountedHistoryLayerHooks += 1;
  if (globalRecoveryListener) return;

  globalRecoveryListener = (event) => {
    recoverInvalidatedCurrentEntry(event.state);
  };
  window.addEventListener('popstate', globalRecoveryListener);
};

const releaseGlobalRecoveryListener = () => {
  if (!canUseWindowHistory()) return;

  mountedHistoryLayerHooks = Math.max(0, mountedHistoryLayerHooks - 1);
  if (mountedHistoryLayerHooks > 0 || !globalRecoveryListener) return;

  window.removeEventListener('popstate', globalRecoveryListener);
  globalRecoveryListener = null;
};

const clearPendingHistoryLayerHandoff = ({ recoverOrphan = false } = {}) => {
  const pending = pendingHistoryLayerHandoff;
  if (!pending) return;

  if (pending.recoveryTimerId) {
    window.clearTimeout(pending.recoveryTimerId);
  }

  if (recoverOrphan && !activeLayerTokens.has(pending.sourceToken)) {
    stripCurrentLayerToken(pending.sourceToken);
  }

  pendingHistoryLayerHandoff = null;
};

const beginHistoryLayerHandoff = (sourceToken) => {
  clearPendingHistoryLayerHandoff({ recoverOrphan: true });
  rememberInvalidatedLayerToken(sourceToken);

  const handoffId = `handoff:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const sourceHref = window.location.href;
  const recoveryTimerId = window.setTimeout(() => {
    if (pendingHistoryLayerHandoff?.handoffId !== handoffId) return;

    pendingHistoryLayerHandoff = null;
    if (
      !activeLayerTokens.has(sourceToken)
      && window.history.state?.[HISTORY_LAYER_KEY] === sourceToken
    ) {
      window.history.back();
    }
  }, HISTORY_HANDOFF_RECOVERY_MS);

  pendingHistoryLayerHandoff = {
    handoffId,
    sourceHref,
    sourceToken,
    recoveryTimerId
  };
};

const claimPendingHistoryLayerHandoff = (nextToken) => {
  const pending = pendingHistoryLayerHandoff;
  if (!pending) return false;

  const canClaim = (
    pending.sourceHref === window.location.href
    && window.history.state?.[HISTORY_LAYER_KEY] === pending.sourceToken
    && !activeLayerTokens.has(pending.sourceToken)
  );

  if (!canClaim) return false;

  window.clearTimeout(pending.recoveryTimerId);
  replaceCurrentLayerToken(nextToken);
  pendingHistoryLayerHandoff = null;
  return true;
};

/**
 * Convierte un modal/drawer visible en una capa compatible con el botón Atrás.
 *
 * Regla UX:
 * - Si la capa está abierta y el usuario presiona Atrás, se cierra la capa superior.
 * - Si hay modales apilados, Atrás cierra solo el más reciente.
 * - Si la capa se cierra desde UI, se consume la entrada de historial creada para ella.
 * - Una transición visual inmediata puede transferir la misma entrada a la capa siguiente.
 * - Si no hay capa abierta, Atrás sigue navegando normalmente.
 */
export function useDismissibleHistoryLayer({
  isOpen,
  onDismiss,
  layerId = 'modal',
  enabled = true
}) {
  const onDismissRef = useRef(onDismiss);
  const layerIdRef = useRef(layerId);
  const ownedLayerIdRef = useRef(null);
  const layerTokenRef = useRef(null);
  const hasHistoryEntryRef = useRef(false);
  const pendingProgrammaticDismissRef = useRef(false);
  const fallbackTimerRef = useRef(null);
  const pendingEffectCleanupRef = useRef(null);
  const isMountedRef = useRef(false);

  onDismissRef.current = onDismiss;
  layerIdRef.current = layerId;

  useEffect(() => {
    isMountedRef.current = true;
    retainGlobalRecoveryListener();
    recoverInvalidatedCurrentEntry();

    return () => {
      isMountedRef.current = false;
      releaseGlobalRecoveryListener();
    };
  }, []);

  const runDismiss = useCallback(() => {
    if (!isMountedRef.current) return;
    onDismissRef.current?.();
  }, []);

  useEffect(() => {
    if (!enabled || !isOpen || !canUseWindowHistory()) return undefined;

    recoverInvalidatedCurrentEntry();

    const pendingEffectCleanup = pendingEffectCleanupRef.current;
    const reusableToken = layerTokenRef.current;
    const canReuseStrictModeEntry = Boolean(
      pendingEffectCleanup
      && reusableToken
      && hasHistoryEntryRef.current
      && window.history.state?.[HISTORY_LAYER_KEY] === reusableToken
    );

    if (pendingEffectCleanup) {
      pendingEffectCleanupRef.current = null;
    }

    let layerToken = reusableToken;
    if (!canReuseStrictModeEntry) {
      activeLayerTokens.delete(reusableToken);
      layerToken = createLayerToken(layerIdRef.current);
      layerTokenRef.current = layerToken;
      hasHistoryEntryRef.current = true;

      const claimedTransferredEntry = claimPendingHistoryLayerHandoff(layerToken);
      if (!claimedTransferredEntry) {
        const currentState = window.history.state && typeof window.history.state === 'object'
          ? window.history.state
          : {};

        window.history.pushState(
          {
            ...currentState,
            [HISTORY_LAYER_KEY]: layerToken
          },
          getHistoryTitle(),
          window.location.href
        );
      }
    }

    ownedLayerIdRef.current = layerIdRef.current;
    pendingProgrammaticDismissRef.current = false;
    activeLayerTokens.add(layerToken);

    const handlePopState = (event) => {
      if (!hasHistoryEntryRef.current && !pendingProgrammaticDismissRef.current) return;

      const ownedToken = layerTokenRef.current;
      const nextLayerToken = event.state?.[HISTORY_LAYER_KEY];
      const browserLayerToken = window.history.state?.[HISTORY_LAYER_KEY];

      if (
        nextLayerToken
        && nextLayerToken !== ownedToken
        && invalidatedLayerTokens.has(nextLayerToken)
      ) {
        return;
      }

      // Un evento sintético o tardío no puede cerrar una capa que todavía posee
      // el marcador realmente activo del navegador.
      if (browserLayerToken === ownedToken && nextLayerToken !== ownedToken) return;

      // Cuando hay modales apilados, el modal inferior sigue siendo el estado activo
      // después de cerrar el superior. En ese caso NO debe cerrarse también.
      if (nextLayerToken === ownedToken && !pendingProgrammaticDismissRef.current) return;

      rememberInvalidatedLayerToken(ownedToken);
      activeLayerTokens.delete(ownedToken);
      hasHistoryEntryRef.current = false;
      pendingProgrammaticDismissRef.current = false;
      layerTokenRef.current = null;
      ownedLayerIdRef.current = null;

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

      const ownedToken = layerTokenRef.current;
      if (!hasHistoryEntryRef.current || !ownedToken) return;

      const cleanupRequest = { token: ownedToken };
      pendingEffectCleanupRef.current = cleanupRequest;

      const finalizeCleanup = () => {
        if (pendingEffectCleanupRef.current !== cleanupRequest) return;
        pendingEffectCleanupRef.current = null;

        rememberInvalidatedLayerToken(ownedToken);
        if (
          hasHistoryEntryRef.current
          && layerTokenRef.current === ownedToken
          && window.history.state?.[HISTORY_LAYER_KEY] === ownedToken
        ) {
          const stripped = stripCurrentLayerToken(ownedToken);
          if (stripped) invalidatedLayerTokens.delete(ownedToken);
        }

        activeLayerTokens.delete(ownedToken);
        if (layerTokenRef.current === ownedToken) {
          hasHistoryEntryRef.current = false;
          pendingProgrammaticDismissRef.current = false;
          layerTokenRef.current = null;
          ownedLayerIdRef.current = null;
        }
      };

      if (typeof queueMicrotask === 'function') {
        queueMicrotask(finalizeCleanup);
      } else {
        Promise.resolve().then(finalizeCleanup);
      }
    };
  }, [enabled, isOpen, runDismiss]);

  useEffect(() => {
    if (!enabled || !isOpen || !canUseWindowHistory()) return;
    if (!hasHistoryEntryRef.current || ownedLayerIdRef.current === layerId) return;

    const previousToken = layerTokenRef.current;
    if (!previousToken || window.history.state?.[HISTORY_LAYER_KEY] !== previousToken) {
      ownedLayerIdRef.current = layerId;
      return;
    }

    const nextToken = createLayerToken(layerId);
    rememberInvalidatedLayerToken(previousToken);
    activeLayerTokens.delete(previousToken);
    replaceCurrentLayerToken(nextToken);
    layerTokenRef.current = nextToken;
    ownedLayerIdRef.current = layerId;
    activeLayerTokens.add(nextToken);
  }, [enabled, isOpen, layerId]);

  const dismiss = useCallback(({ handoffHistory = false } = {}) => {
    if (!canUseWindowHistory()) {
      runDismiss();
      return;
    }

    const ownedToken = layerTokenRef.current;
    const currentLayerToken = window.history.state?.[HISTORY_LAYER_KEY];
    const ownsCurrentEntry = (
      hasHistoryEntryRef.current
      && ownedToken
      && currentLayerToken === ownedToken
    );

    if (!ownsCurrentEntry) {
      runDismiss();
      return;
    }

    if (handoffHistory) {
      if (fallbackTimerRef.current) {
        window.clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }

      activeLayerTokens.delete(ownedToken);
      beginHistoryLayerHandoff(ownedToken);
      hasHistoryEntryRef.current = false;
      pendingProgrammaticDismissRef.current = false;
      layerTokenRef.current = null;
      ownedLayerIdRef.current = null;
      runDismiss();
      return;
    }

    pendingProgrammaticDismissRef.current = true;
    window.history.back();

    // Fallback defensivo para entornos donde popstate no se emite de forma normal.
    fallbackTimerRef.current = window.setTimeout(() => {
      if (!pendingProgrammaticDismissRef.current) return;

      const pendingToken = layerTokenRef.current;
      pendingProgrammaticDismissRef.current = false;
      hasHistoryEntryRef.current = false;
      activeLayerTokens.delete(pendingToken);
      stripCurrentLayerToken(pendingToken);
      layerTokenRef.current = null;
      ownedLayerIdRef.current = null;
      fallbackTimerRef.current = null;
      runDismiss();
    }, 150);
  }, [runDismiss]);

  return dismiss;
}
