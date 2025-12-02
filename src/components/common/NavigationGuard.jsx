import { useEffect } from 'react';
import { useOrderStore } from '../../store/useOrderStore';

export default function NavigationGuard() {
  const order = useOrderStore((state) => state.order);

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      // Si hay productos en el carrito, activar la alerta del navegador
      if (order.length > 0) {
        e.preventDefault();
        e.returnValue = ''; // Estándar para Chrome/Edge
        return ''; // Estándar para otros
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [order]);

  return null; // Este componente no renderiza nada visual
}