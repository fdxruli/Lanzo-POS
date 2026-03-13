import { useEffect } from 'react';
import { useOrderStore } from '../../store/useOrderStore';
import { useAppStore } from '../../store/useAppStore';

export default function NavigationGuard() {
  const order = useOrderStore((state) => state.order);
  const isBackupLoading = useAppStore((state) => state.isBackupLoading);

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      // Si hay productos en el carrito, activar la alerta del navegador
      if (order.length > 0 || isBackupLoading) {
        e.preventDefault();
        e.returnValue = ''; // Estándar para Chrome/Edge
        return ''; // Estándar para otros
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [order, isBackupLoading]);

  return null; // Este componente no renderiza nada visual
}
