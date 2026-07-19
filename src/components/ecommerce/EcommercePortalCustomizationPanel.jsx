import { useEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus, RotateCcw, Trash2, UploadCloud } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  ECOMMERCE_PORTAL_CORNER_STYLES,
  ECOMMERCE_PORTAL_FONT_STYLES,
  ECOMMERCE_PORTAL_TEMPLATES,
  buildEcommercePortalThemeStyle,
  getEcommercePortalThemeDefaults,
  isEcommercePortalHexColor,
  normalizeEcommercePortalTemplate,
  normalizeEcommercePortalTheme
} from '../../utils/ecommercePortalTheme';
import { IMAGE_UPLOAD_PURPOSES, uploadImageFile } from '../../services/storage/imageUploadService';
import './EcommercePortalCustomizationPanel.css';

const TEMPLATES = {
  classic: ['Clásica', 'La apariencia actual, equilibrada y familiar.'],
  showcase: ['Escaparate', 'Más protagonismo para portada, identidad e imágenes.'],
  compact: ['Compacta', 'Mayor densidad sin perder objetivos táctiles.']
};
const CORNERS = { rounded: 'Redondeadas', soft: 'Suaves', square: 'Rectas' };
const FONTS = { system: 'Sistema', rounded: 'Redondeada', editorial: 'Editorial' };
const IMAGE_INTENTS = Object.freeze({ PRESERVE: 'preserve', SET: 'set', CLEAR: 'clear' });

const sanitizeUrl = (value) => (
  typeof value === 'string' && /^https:\/\//i.test(value.trim()) ? value.trim() : null
);
const preservedImage = (value) => ({ value: sanitizeUrl(value), intent: IMAGE_INTENTS.PRESERVE });
const uploadErrorMessage = (error) => error?.message || 'No se pudo subir la imagen. Intenta nuevamente.';
const clearImage = (setImage) => setImage({ value: null, intent: IMAGE_INTENTS.CLEAR });

export default function EcommercePortalCustomizationPanel({
  isPro,
  portal,
  initialLogoUrl = null,
  licenseKey,
  disabled = false,
  onChange,
  onBusyChange
}) {
  const [templateCode, setTemplateCode] = useState('classic');
  const [theme, setTheme] = useState(getEcommercePortalThemeDefaults);
  const [logo, setLogo] = useState(() => preservedImage(null));
  const [cover, setCover] = useState(() => preservedImage(null));
  const [busy, setBusy] = useState(false);
  const urls = useRef(new Set());

  useEffect(() => {
    setTemplateCode(normalizeEcommercePortalTemplate(portal?.templateCode));
    setTheme(normalizeEcommercePortalTheme(portal?.theme));
    setLogo(preservedImage(portal?.logoUrl || initialLogoUrl));
    setCover(preservedImage(portal?.coverImageUrl));
  }, [initialLogoUrl, portal]);
  useEffect(() => () => urls.current.forEach((url) => URL.revokeObjectURL(url)), []);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);

  const colorsValid = isEcommercePortalHexColor(theme.primaryColor)
    && isEcommercePortalHexColor(theme.secondaryColor);
  const normalizedTheme = useMemo(() => normalizeEcommercePortalTheme(theme), [theme]);
  const previewStyle = useMemo(() => buildEcommercePortalThemeStyle(normalizedTheme), [normalizedTheme]);

  useEffect(() => {
    onChange?.({
      templateCode: isPro ? normalizeEcommercePortalTemplate(templateCode) : 'classic',
      theme: isPro ? normalizedTheme : {},
      logo: { ...logo },
      cover: { ...cover },
      // Kept for callers that only need display values; intent is authoritative for saving.
      logoUrl: logo.value,
      coverImageUrl: isPro ? cover.value : null,
      valid: !isPro || colorsValid
    });
  }, [colorsValid, cover, isPro, logo, normalizedTheme, onChange, templateCode]);

  const changeColor = (field, value) => setTheme((current) => ({ ...current, [field]: value }));
  const upload = async ({ file, purpose, image, setImage }) => {
    if (!file || busy || disabled || !isPro) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      toast.error('Necesitas conexión a internet para subir imágenes.');
      return;
    }

    const previousImage = image;
    const preview = URL.createObjectURL(file);
    urls.current.add(preview);
    // A temporary preview never becomes an intent to save.
    setImage({ ...previousImage, value: preview });
    setBusy(true);
    try {
      const result = await uploadImageFile({ file, licenseKey, purpose });
      const publicUrl = sanitizeUrl(result?.publicUrl);
      if (!publicUrl) throw new Error('El servidor no devolvió una URL pública válida para la imagen.');
      setImage({ value: publicUrl, intent: IMAGE_INTENTS.SET });
    } catch (error) {
      setImage(previousImage);
      toast.error(uploadErrorMessage(error));
    } finally {
      URL.revokeObjectURL(preview);
      urls.current.delete(preview);
      setBusy(false);
    }
  };
  const reset = () => {
    setTemplateCode('classic');
    setTheme(getEcommercePortalThemeDefaults());
    // Product behaviour: reset appearance removes the portal cover only, never the logo.
    setCover({ value: null, intent: IMAGE_INTENTS.CLEAR });
  };

  if (!isPro) return (
    <section className="ecom-customization ecom-customization--locked" aria-label="Personalización Portal PRO">
      <strong>Personalización Portal PRO</strong>
      <p>La personalización avanzada está disponible en Lanzo Nube. Tu tienda Free conserva la plantilla clásica.</p>
    </section>
  );

  const imageControls = [
    ['Logo', logo, setLogo, IMAGE_UPLOAD_PURPOSES.BUSINESS_LOGO],
    ['Portada', cover, setCover, IMAGE_UPLOAD_PURPOSES.BUSINESS_COVER]
  ];

  return (
    <section className="ecom-customization" aria-label="Personalización visual">
      <div className="ecom-customization__heading"><div><h3>Personaliza tu tienda</h3><p>Los cambios se previsualizan aquí y se validan al guardar.</p></div><button type="button" className="btn btn-secondary" onClick={reset} disabled={disabled || busy}><RotateCcw size={16} /> Restablecer</button></div>
      <div className="ecom-customization__grid">
        <div>
          <fieldset><legend>Plantilla</legend><div className="ecom-template-options">{ECOMMERCE_PORTAL_TEMPLATES.map((code) => <button key={code} type="button" aria-pressed={templateCode === code} className={`ecom-template-option ${templateCode === code ? 'is-selected' : ''}`} onClick={() => setTemplateCode(code)} disabled={disabled || busy}><span className={`ecom-template-option__art ecom-template-option__art--${code}`} /><strong>{TEMPLATES[code][0]}</strong><small>{TEMPLATES[code][1]}</small></button>)}</div></fieldset>
          <fieldset><legend>Colores</legend>{['primaryColor', 'secondaryColor'].map((field) => <label className="ecom-color-field" key={field}><span>{field === 'primaryColor' ? 'Color principal' : 'Color secundario'}</span><input type="color" value={isEcommercePortalHexColor(theme[field]) ? theme[field] : '#000000'} onChange={(event) => changeColor(field, event.target.value)} disabled={disabled || busy} /><input value={theme[field]} maxLength={7} aria-invalid={!isEcommercePortalHexColor(theme[field])} onChange={(event) => changeColor(field, event.target.value)} disabled={disabled || busy} />{!isEcommercePortalHexColor(theme[field]) ? <small role="alert">Usa un color hexadecimal como #0284c7.</small> : null}</label>)}</fieldset>
          <fieldset><legend>Esquinas</legend><div className="ecom-choice-row">{ECOMMERCE_PORTAL_CORNER_STYLES.map((value) => <button key={value} type="button" aria-pressed={theme.cornerStyle === value} onClick={() => setTheme((current) => ({ ...current, cornerStyle: value }))} disabled={disabled || busy}>{CORNERS[value]}</button>)}</div></fieldset>
          <fieldset><legend>Tipografía</legend><div className="ecom-choice-row">{ECOMMERCE_PORTAL_FONT_STYLES.map((value) => <button key={value} type="button" aria-pressed={theme.fontStyle === value} onClick={() => setTheme((current) => ({ ...current, fontStyle: value }))} disabled={disabled || busy}>{FONTS[value]}</button>)}</div></fieldset>
          <fieldset><legend>Imágenes</legend><div className="ecom-image-actions">{imageControls.map(([label, image, setImage, purpose]) => <div key={label} className="ecom-image-action">{image.value ? <img src={image.value} alt={`${label} actual`} /> : <ImagePlus aria-hidden="true" />}<strong>{label}</strong><label className="btn btn-secondary"><UploadCloud size={16} /> Cambiar<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => upload({ file: event.target.files?.[0], purpose, image, setImage })} disabled={disabled || busy} /></label>{image.value ? <button type="button" className="btn btn-secondary" onClick={() => clearImage(setImage)} disabled={disabled || busy}><Trash2 size={16} /> Desvincular</button> : null}</div>)}</div></fieldset>
        </div>
        <aside className="ecom-customization__preview" style={previewStyle} data-template-code={normalizeEcommercePortalTemplate(templateCode)}><span>Vista previa</span>{cover.value ? <img src={cover.value} alt="" className="ecom-preview-cover" /> : <div className="ecom-preview-cover" />}{logo.value ? <img src={logo.value} alt="" className="ecom-preview-logo" /> : null}<h4>Tu negocio</h4><p>Una experiencia pensada para tus clientes.</p><button type="button">Ver productos</button></aside>
      </div>
    </section>
  );
}
