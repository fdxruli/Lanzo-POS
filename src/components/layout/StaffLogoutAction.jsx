import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useActorRuntimeSnapshot } from '../../services/auth/useActorRuntimeSnapshot';
import { showConfirmModal, showMessageModal } from '../../services/utils';

const STAFF_LOGOUT_CONFIRMATION =
  '¿Cerrar tu sesión Staff en este dispositivo? Los datos locales y las operaciones ya guardadas se conservarán en este negocio. No se liberará el dispositivo ni se borrará la información.';

export default function StaffLogoutAction({ className = '', disabled = false, onLogoutConfirmed }) {
  const actor = useActorRuntimeSnapshot();
  const logoutStaff = useAppStore((state) => state.logoutStaff);
  const isLoggingOut = useAppStore((state) => state._isLoggingOut === true);
  const [isConfirming, setIsConfirming] = useState(false);

  if (actor.status !== 'granted' || actor.actorType !== 'staff') return null;

  const handleLogout = async () => {
    if (disabled) {
      showMessageModal(
        'Espera a que termine el respaldo o la restauración antes de cerrar sesión.',
        null,
        { type: 'warning' }
      );
      return;
    }
    if (isLoggingOut || isConfirming) return;
    setIsConfirming(true);
    try {
      const confirmed = await showConfirmModal(STAFF_LOGOUT_CONFIRMATION, {
        title: 'Cerrar sesión Staff',
        confirmButtonText: 'Sí, cerrar sesión',
        cancelButtonText: 'Seguir trabajando'
      });
      if (!confirmed) return;

      onLogoutConfirmed?.();
      const result = await logoutStaff();
      if (!result?.success) {
        showMessageModal(
          result?.message || 'No se pudo cerrar la sesión Staff. La sesión actual sigue protegida.',
          null,
          { type: 'warning' }
        );
      }
    } catch {
      showMessageModal(
        'No se pudo completar el cierre de sesión Staff. Revisa la operación pendiente e inténtalo de nuevo.',
        null,
        { type: 'error' }
      );
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <button
      type="button"
      className={className}
      onClick={handleLogout}
      disabled={isLoggingOut || isConfirming}
      aria-disabled={disabled || isLoggingOut || isConfirming}
      title={disabled ? 'Espera a que termine el respaldo o la restauración.' : undefined}
      aria-label="Cerrar sesión Staff"
    >
      <LogOut size={20} aria-hidden="true" />
      <span>{isLoggingOut ? 'Cerrando sesión...' : 'Cerrar sesión Staff'}</span>
    </button>
  );
}
