import { useEffect } from 'react';
import { useActiveOrders } from '../../hooks/pos/useActiveOrders';
import { useAppStore } from '../../store/useAppStore';

export default function NavigationGuard() {
  const hasItems = useActiveOrders((state) => (
    state.currentOrderId
      ? (state.activeOrders.get(state.currentOrderId)?.items?.length ?? 0) > 0
      : false
  ));
  const isBackupLoading = useAppStore((state) => state.isBackupLoading);

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      // Si hay productos en el carrito, activar la alerta del navegador
      if (hasItems || isBackupLoading) {
        e.preventDefault();
        e.returnValue = ''; // Estándar para Chrome/Edge
        return ''; // Estándar para otros
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [hasItems, isBackupLoading]);

  return null; // Este componente no renderiza nada visual
}
