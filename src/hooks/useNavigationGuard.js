import { useCallback, useEffect, useRef } from 'react';
import { useBlocker } from 'react-router-dom';
import { showMessageModal } from '../services/utils';

const DEFAULT_MESSAGE = 'Hay una operación en curso. Si sales ahora, los datos no guardados se perderán. ¿Seguro que quieres salir?';

export function useNavigationGuard({
  enabled,
  message = DEFAULT_MESSAGE,
  title = '¿Salir?',
  confirmButtonText = 'Sí, salir',
  cancelButtonText = 'Continuar editando',
  onDiscard
}) {
  const skipNextNavigationRef = useRef(false);
  const promptOpenRef = useRef(false);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => (
    enabled
    && !skipNextNavigationRef.current
    && (
      currentLocation.pathname !== nextLocation.pathname
      || currentLocation.search !== nextLocation.search
      || currentLocation.hash !== nextLocation.hash
    )
  ));

  useEffect(() => {
    if (!enabled) return undefined;

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [enabled]);

  useEffect(() => {
    if (blocker.state !== 'blocked' || promptOpenRef.current) return;

    promptOpenRef.current = true;

    showMessageModal(
      message,
      () => {
        promptOpenRef.current = false;
        onDiscard?.();
        blocker.proceed();
      },
      {
        type: 'warning',
        title,
        confirmButtonText,
        cancelButtonText,
        showCancel: true,
        isDismissible: false,
        onCancel: () => {
          promptOpenRef.current = false;
          blocker.reset();
        }
      }
    );
  }, [
    blocker,
    cancelButtonText,
    confirmButtonText,
    message,
    onDiscard,
    title
  ]);

  const runWithoutBlocking = useCallback((action) => {
    skipNextNavigationRef.current = true;
    try {
      action();
    } finally {
      queueMicrotask(() => {
        skipNextNavigationRef.current = false;
      });
    }
  }, []);

  return { runWithoutBlocking };
}
