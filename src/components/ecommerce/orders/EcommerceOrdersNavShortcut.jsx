import { ShoppingBag } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useAppStore } from '../../../store/useAppStore';
import { canAccessEcommerceOrders } from '../../../services/ecommerce/ecommerceOrderCapabilities';
import './EcommerceOrdersNavShortcut.css';

export default function EcommerceOrdersNavShortcut() {
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
  const currentStaffUser = useAppStore((state) => state.currentStaffUser);
  const newCount = useAppStore((state) => state.ecommerceOrderCounts?.new || 0);

  const allowed = canAccessEcommerceOrders(licenseDetails, {
    currentDeviceRole,
    currentStaffUser
  });

  if (!allowed) return null;

  const badge = Number(newCount || 0) > 99 ? '99+' : String(Number(newCount || 0));

  return (
    <NavLink
      to="/pedidos-online"
      className={({ isActive }) => [
        'ecommerce-orders-nav-shortcut',
        isActive ? 'is-active' : ''
      ].filter(Boolean).join(' ')}
      aria-label={Number(newCount || 0) > 0
        ? `Pedidos online, ${badge} nuevos`
        : 'Pedidos online'}
    >
      <ShoppingBag size={19} aria-hidden="true" />
      <span>Pedidos online</span>
      {Number(newCount || 0) > 0 && <strong>{badge}</strong>}
    </NavLink>
  );
}
