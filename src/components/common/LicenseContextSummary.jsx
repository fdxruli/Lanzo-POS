import { BadgeCheck, KeyRound, Store } from 'lucide-react';
import './LicenseContextSummary.css';

const firstText = (...values) => values.find((value) => typeof value === 'string' && value.trim())?.trim() || '';

const standardLicenseKeyHint = (licenseKey) => {
  const match = typeof licenseKey === 'string'
    ? licenseKey.trim().match(/^LANZO-[A-Z\d]{4}-[A-Z\d]{4}-[A-Z\d]{4}-([A-Z\d]{4})$/i)
    : null;

  return match ? `Licencia LANZO ···· ${match[1].toUpperCase()}` : '';
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
  const licenseId = firstText(licenseDetails?.license_id, licenseDetails?.licenseId);
  const resolvedBusinessName = firstText(
    businessName,
    licenseDetails?.business_name,
    licenseDetails?.company_name,
    licenseDetails?.business_profile?.business_name,
    licenseDetails?.business_profile?.name
  );
  const licenseLabel = licenseId
    ? `Licencia ${licenseId}`
    : standardLicenseKeyHint(licenseKey) || (licenseKey ? 'Licencia protegida' : 'Licencia pendiente');

  return (
    <div className={`auth-license-context${showBusiness ? ' auth-license-context--business' : ''}`}>
      <span className="auth-license-context__icon" aria-hidden="true">
        {showBusiness ? <Store size={18} strokeWidth={2.2} /> : <KeyRound size={18} strokeWidth={2.2} />}
      </span>
      <div className="auth-license-context__copy">
        <span className="auth-license-context__eyebrow">
          {showBusiness && resolvedBusinessName ? 'Negocio vinculado' : 'Licencia vinculada'}
        </span>
        <strong className="auth-license-context__license">
          {licenseLabel}
        </strong>
        <span className="auth-license-context__meta">
          <span className="auth-license-context__primary">
            {showBusiness && resolvedBusinessName ? resolvedBusinessName : productName}
          </span>
          {planName && (
            <>
              <span className="auth-license-context__separator" aria-hidden="true">·</span>
              <span className="auth-license-context__plan">{planName}</span>
            </>
          )}
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
