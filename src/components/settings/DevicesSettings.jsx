import { ShieldCheck, Smartphone } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useSettingsAccess } from '../../services/auth/useSettingsAccess';
import DeviceManager from '../common/DeviceManager';
import NoPermission from '../common/NoPermission';

export default function DevicesSettings() {
  const access = useSettingsAccess();
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const currentStaffUser = useAppStore((state) => state.currentStaffUser);

  if (!access.canAccessSection('devices')) return <NoPermission />;

  return (
    <div className="license-settings-shell" data-testid="devices-settings">
      <header className="license-settings-hero">
        <div className="license-hero-copy">
          <span className="license-kicker">
            <Smartphone size={15} />
            Dispositivos
          </span>
          <div>
            <h2>Equipos vinculados</h2>
            <p>Consulta el acceso de este equipo y, como Admin, administra los dispositivos de la licencia.</p>
          </div>
        </div>
      </header>

      {access.isAdmin ? (
        <section className="license-panel license-linked-devices">
          <div className="license-panel-heading">
            <div>
              <h3>Dispositivos vinculados</h3>
              <p>Revisa equipos conectados, cambia su capacidad y libera cupos.</p>
            </div>
            <span className="license-panel-badge">
              <Smartphone size={15} />
              Admin
            </span>
          </div>

          {licenseDetails?.valid && licenseDetails?.license_key
            ? <DeviceManager licenseKey={licenseDetails.license_key} />
            : <p role="status">La licencia debe estar activa para administrar equipos.</p>}
        </section>
      ) : (
        <section className="license-panel license-linked-devices" data-testid="staff-device-readonly">
          <div className="license-panel-heading">
            <div>
              <h3>Dispositivo actual</h3>
              <p>Tu permiso permite consultar el estado de esta sesion, sin exponer controles administrativos.</p>
            </div>
            <span className="license-panel-badge">
              <ShieldCheck size={15} />
              Solo lectura
            </span>
          </div>

          <dl className="license-details-grid">
            <div>
              <dt>Actor</dt>
              <dd>{currentStaffUser?.display_name || currentStaffUser?.username || access.actorId}</dd>
            </div>
            <div>
              <dt>Tipo de sesion</dt>
              <dd>Staff</dd>
            </div>
            <div>
              <dt>Administracion remota</dt>
              <dd>Disponible solo para Admin</dd>
            </div>
          </dl>
        </section>
      )}
    </div>
  );
}
