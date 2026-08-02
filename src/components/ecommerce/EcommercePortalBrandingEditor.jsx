import { LoaderCircle, Save } from 'lucide-react';
import EcommercePortalCustomizationPanel from './EcommercePortalCustomizationPanel';

export default function EcommercePortalBrandingEditor({
  portal,
  initialLogoUrl,
  licenseKey,
  customization,
  saving = false,
  uploading = false,
  onCustomizationChange,
  onUploadingChange,
  onSave
}) {
  const disabled = saving || uploading || customization?.valid === false;

  return (
    <section className="ui-card ecom-admin-form-card ecom-branding-editor" aria-labelledby="ecom-branding-editor-title">
      <div className="ecom-admin-card-heading">
        <div>
          <span className="ecom-admin-eyebrow">Identidad visual</span>
          <h2 id="ecom-branding-editor-title">Identidad visual</h2>
          <p>Colores, tipografía, logo, portada y plantilla.</p>
        </div>
      </div>
      <EcommercePortalCustomizationPanel
        isPro
        portal={portal}
        initialLogoUrl={initialLogoUrl}
        licenseKey={licenseKey}
        disabled={saving}
        onChange={onCustomizationChange}
        onBusyChange={onUploadingChange}
      />
      <div className="ecom-admin-form-actions">
        <span>La identidad visual se guarda en el portal. Los cambios de estructura requieren guardar el borrador y publicarlo.</span>
        <button type="button" className="btn btn-primary" onClick={onSave} disabled={disabled}>
          {saving ? <LoaderCircle className="ecom-admin-spin" size={17} /> : <Save size={17} />}
          {' '}Guardar identidad visual
        </button>
      </div>
    </section>
  );
}
