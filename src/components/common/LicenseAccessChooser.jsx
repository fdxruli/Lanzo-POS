import { ShieldCheck, Users } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import './AdminAuthModal.css';

export default function LicenseAccessChooser() {
  const chooseLicenseAccess = useAppStore((state) => state.chooseLicenseAccess);
  const logout = useAppStore((state) => state.logout);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const staffAccessAvailable = licenseDetails?.staff_access_available === true
    || licenseDetails?.features?.staff_roles === true;

  return (
    <div className="admin-auth-overlay" role="dialog" aria-modal="true" aria-labelledby="access-title">
      <section className="admin-auth-panel access-choice-panel">
        <h1 id="access-title">¿Cómo deseas ingresar?</h1>
        <p>La licencia identifica tu suscripción. Elige el tipo de cuenta que usarás en este dispositivo.</p>
        <div className="access-choice-grid">
          <button type="button" className="access-choice-card" onClick={() => chooseLicenseAccess('admin')}>
            <ShieldCheck size={30} />
            <strong>Administrador</strong>
            <span>Usa las credenciales del propietario.</span>
          </button>
          {staffAccessAvailable && (
            <button type="button" className="access-choice-card" onClick={() => chooseLicenseAccess('staff')}>
              <Users size={30} />
              <strong>Personal / Staff</strong>
              <span>Usa el usuario asignado por el administrador.</span>
            </button>
          )}
        </div>
        <button type="button" className="ui-button ui-button--ghost" onClick={logout}>Cambiar licencia</button>
      </section>
    </div>
  );
}
