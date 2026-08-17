import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, BadgeCheck, ShieldCheck, Users } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { getBusinessProfile } from '../../services/supabase';
import LicenseContextSummary from './LicenseContextSummary';
import './AdminAuthModal.css';

export default function LicenseAccessChooser() {
  const chooseLicenseAccess = useAppStore((state) => state.chooseLicenseAccess);
  const logout = useAppStore((state) => state.logout);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const companyProfile = useAppStore((state) => state.companyProfile);
  const staffAccessAvailable = licenseDetails?.staff_access_available === true
    || licenseDetails?.features?.staff_roles === true;
  const planName = licenseDetails?.plan_name || licenseDetails?.planName || 'Licencia registrada';
  const licenseKey = licenseDetails?.license_key;
  const businessName = companyProfile?.business_name || companyProfile?.name || '';
  const [remoteBusinessName, setRemoteBusinessName] = useState('');
  const [businessLoading, setBusinessLoading] = useState(false);
  const resolvedBusinessName = businessName || remoteBusinessName;

  useEffect(() => {
    let isCurrent = true;
    setRemoteBusinessName('');

    if (!licenseKey || businessName) {
      setBusinessLoading(false);
      return () => {
        isCurrent = false;
      };
    }

    setBusinessLoading(true);
    getBusinessProfile(licenseKey)
      .then((profileResult) => {
        if (!isCurrent) return;
        const profile = profileResult?.data || profileResult?.profile || null;
        setRemoteBusinessName(profile?.business_name || profile?.name || '');
      })
      .catch(() => {
        if (isCurrent) setRemoteBusinessName('');
      })
      .finally(() => {
        if (isCurrent) setBusinessLoading(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [businessName, licenseKey]);

  return (
    <div
      className="admin-auth-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="access-title"
      aria-describedby="access-description"
    >
      <section className="admin-auth-panel access-choice-panel">
        <header className="access-choice-header">
          <div className="access-choice-header__topline">
            <span className="access-choice-step">Paso 2 de 2</span>
            <span className="access-choice-status">
              <span className="access-choice-status__dot" aria-hidden="true" />
              {planName}
            </span>
          </div>

          <div className="access-choice-title-row">
            <div className="access-choice-mark" aria-hidden="true">
              <BadgeCheck size={24} strokeWidth={2.2} />
            </div>
            <div>
              <h1 id="access-title">¿Cómo deseas ingresar?</h1>
              <p id="access-description">Selecciona el perfil que usarás en este dispositivo.</p>
            </div>
          </div>
        </header>

        <LicenseContextSummary
          licenseDetails={licenseDetails}
          licenseKey={licenseKey}
          businessName={resolvedBusinessName}
          businessLoading={businessLoading}
          showBusiness
        />

        <p className="access-choice-guidance">
          Cada opción abre el acceso correcto y mantiene tus permisos separados.
        </p>

        <div className="access-choice-grid" aria-label="Tipos de cuenta disponibles">
          <button
            type="button"
            className="access-choice-card access-choice-card--admin"
            onClick={() => chooseLicenseAccess('admin')}
          >
            <span className="access-choice-card__icon" aria-hidden="true">
              <ShieldCheck size={25} strokeWidth={2.2} />
            </span>
            <span className="access-choice-card__copy">
              <strong>Administrador</strong>
              <span>Usa las credenciales del propietario.</span>
            </span>
            <ArrowRight className="access-choice-card__arrow" size={19} aria-hidden="true" />
          </button>
          {staffAccessAvailable && (
            <button
              type="button"
              className="access-choice-card access-choice-card--staff"
              onClick={() => chooseLicenseAccess('staff')}
            >
              <span className="access-choice-card__icon" aria-hidden="true">
                <Users size={25} strokeWidth={2.2} />
              </span>
              <span className="access-choice-card__copy">
                <strong>Personal / Staff</strong>
                <span>Usa el usuario asignado por el administrador.</span>
              </span>
              <ArrowRight className="access-choice-card__arrow" size={19} aria-hidden="true" />
            </button>
          )}
        </div>

        <footer className="access-choice-footer">
          <button type="button" className="ui-button ui-button--ghost" onClick={logout}>
            <ArrowLeft size={17} aria-hidden="true" />
            Cambiar licencia
          </button>
          <span className="access-choice-security">
            <ShieldCheck size={16} aria-hidden="true" />
            Acceso protegido
          </span>
        </footer>
      </section>
    </div>
  );
}
