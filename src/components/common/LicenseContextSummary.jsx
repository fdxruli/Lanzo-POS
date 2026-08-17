import { BadgeCheck, KeyRound, Store } from 'lucide-react';
import './LicenseContextSummary.css';

const firstText = (...values) => values.find((value) => typeof value === 'string' && value.trim())?.trim() || '';

const compactLicenseKey = (licenseKey) => {
  if (!licenseKey) return 'Licencia pendiente';
  return `Licencia ${licenseKey.slice(0, 12)}...`;
};

export default function LicenseContextSummary({
  licenseDetails,
  licenseKey,
  businessName = '',
  showBusiness = false,
  businessLoading = false
}) {
  const productName = firstText(
    licenseDetails?.product_name,
    licenseDetails?.productName,
    'Lanzo POS'
  );
  const planName = firstText(licenseDetails?.plan_name, licenseDetails?.planName);
  const resolvedBusinessName = firstText(
    businessName,
    licenseDetails?.business_name,
    licenseDetails?.company_name,
    licenseDetails?.business_profile?.business_name,
    licenseDetails?.business_profile?.name
  );

  return (
    <div className={`auth-license-context${showBusiness ? ' auth-license-context--business' : ''}`}>
      <span className="auth-license-context__icon" aria-hidden="true">
        {showBusiness ? <Store size={18} strokeWidth={2.2} /> : <KeyRound size={18} strokeWidth={2.2} />}
      </span>
      <div className="auth-license-context__copy">
        <span className="auth-license-context__eyebrow">
          {showBusiness && resolvedBusinessName ? 'Negocio vinculado' : 'Licencia vinculada'}
        </span>
        <strong className="auth-license-context__license">{compactLicenseKey(licenseKey)}</strong>
        <span className="auth-license-context__meta">
          {showBusiness && resolvedBusinessName ? resolvedBusinessName : productName}
          {planName ? ` · ${planName}` : ''}
        </span>
        {showBusiness && !resolvedBusinessName && businessLoading && (
          <span className="auth-license-context__business-fallback">Consultando información del negocio...</span>
        )}
      </div>
      <span className="auth-license-context__status">
        <BadgeCheck size={15} aria-hidden="true" />
        Verificada
      </span>
    </div>
  );
}
