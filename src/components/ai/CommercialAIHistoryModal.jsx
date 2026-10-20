import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

const visibleControls = (dialog) => Array.from(dialog.querySelectorAll(focusableSelector)).filter((element) => {
  if (element.closest('[hidden], [inert]')) return false;
  for (let parent = element; parent && parent !== dialog; parent = parent.parentElement) {
    if (getComputedStyle(parent).display === 'none' || getComputedStyle(parent).visibility === 'hidden') return false;
    if (parent.tagName === 'DETAILS' && !parent.open && !parent.querySelector('summary')?.contains(element)) return false;
  }
  return true;
});

// Follows the Ecommerce portal modal pattern. Lanzo also scrolls layout
// ancestors, so their inline overflow and the background's inert state are saved.
export default function CommercialAIHistoryModal({ children, count, isLoading, onClose, isConfirming, onCancelConfirmation }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const actionsRef = useRef({ onClose, isConfirming, onCancelConfirmation });

  useLayoutEffect(() => {
    actionsRef.current = { onClose, isConfirming, onCancelConfirmation };
  }, [onClose, isConfirming, onCancelConfirmation]);

  useLayoutEffect(() => {
    const previousFocus = document.activeElement;
    const overlay = dialogRef.current.parentElement;
    const background = Array.from(document.body.children).filter((element) => element !== overlay);
    const inertStates = background.map((element) => [element, element.getAttribute('inert'), element.getAttribute('aria-hidden')]);
    const scrollers = new Set([document.body, document.documentElement]);
    for (let parent = previousFocus?.parentElement; parent; parent = parent.parentElement) scrollers.add(parent);
    const scrollStates = Array.from(scrollers).map((element) => ({
      element, overflow: element.style.getPropertyValue('overflow'),
      priority: element.style.getPropertyPriority('overflow'), top: element.scrollTop, left: element.scrollLeft
    }));
    scrollers.forEach((element) => element.style.setProperty('overflow', 'hidden'));
    closeRef.current?.focus({ preventScroll: true });
    background.forEach((element) => {
      element.setAttribute('inert', '');
      element.setAttribute('aria-hidden', 'true');
    });

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        const actions = actionsRef.current;
        if (actions.isConfirming) actions.onCancelConfirmation();
        else actions.onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = visibleControls(dialogRef.current);
      event.preventDefault();
      const index = controls.indexOf(document.activeElement);
      const nextIndex = index < 0 ? (event.shiftKey ? controls.length - 1 : 0)
        : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
      (controls[nextIndex] || closeRef.current)?.focus({ preventScroll: true });
    };
    const containFocus = (event) => {
      if (!dialogRef.current.contains(event.target)) closeRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('focusin', containFocus);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('focusin', containFocus);
      inertStates.forEach(([element, value, ariaHidden]) => {
        if (value === null) element.removeAttribute('inert');
        else element.setAttribute('inert', value);
        if (ariaHidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', ariaHidden);
      });
      scrollStates.forEach(({ element, overflow, priority, top, left }) => {
        if (overflow) element.style.setProperty('overflow', overflow, priority);
        else element.style.removeProperty('overflow');
        element.scrollTop = top;
        element.scrollLeft = left;
      });
      if (previousFocus?.isConnected) previousFocus.focus?.({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <div className="commercial-ai-history-backdrop">
      <section ref={dialogRef} className="commercial-ai-history-modal" role="dialog" aria-modal="true"
        aria-labelledby="commercial-ai-history-title" aria-describedby="commercial-ai-history-privacy">
        <header className="commercial-ai-history-modal__header">
          <div>
            <h2 id="commercial-ai-history-title">Historial de consultas</h2>
            <p role="status">{isLoading ? 'Cargando historial local…' : count === null ? 'Revisa el aviso del historial local' : `${count} consulta${count === 1 ? '' : 's'} guardada${count === 1 ? '' : 's'}`}</p>
          </div>
          <button ref={closeRef} type="button" className="commercial-ai-history-modal__close" aria-label="Cerrar historial"
            disabled={isConfirming} onClick={onClose}><X size={20} aria-hidden="true" /></button>
        </header>
        <div className="commercial-ai-history-modal__body">{children}</div>
      </section>
    </div>, document.body
  );
}
