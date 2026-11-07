import { useSingleInstance } from '../../hooks/useSingleInstance';
import SingleInstanceBlockedScreen from './SingleInstanceBlockedScreen';

/**
 * Resolve tab ownership before PosApplicationBootstrap can prepare its database,
 * activate sync or restore any actor. Never infer authorization from the lock.
 */
export default function SingleInstanceGate({ children }) {
  const isDuplicate = useSingleInstance();

  if (isDuplicate === true) return <SingleInstanceBlockedScreen />;
  if (isDuplicate !== false) {
    return (
      <main id="app-loader" role="status" aria-live="polite">
        <div className="loader-spinner" aria-hidden="true" />
        <p>Comprobando ventana activa de Lanzo POS...</p>
      </main>
    );
  }
  return children;
}
