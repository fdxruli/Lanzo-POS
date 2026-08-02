import {
  getEcommercePortalThemeDefaults,
  normalizeEcommercePortalTemplate,
  normalizeEcommercePortalTheme
} from './ecommercePortalTheme';

const MAX_DOCUMENT_BYTES = 64 * 1024;
const MAX_SECTIONS = 30;
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const ROOT_KEYS = new Set(['schemaVersion', 'global', 'sections']);
const GLOBAL_KEYS = new Set(['contentWidth', 'density', 'appearance']);
const APPEARANCE_KEYS = new Set(['templateCode', 'theme', 'branding']);
const THEME_KEYS = new Set(['primaryColor', 'secondaryColor', 'cornerStyle', 'fontStyle']);
const BRANDING_KEYS = new Set(['logoUrl', 'coverImageUrl']);
const SECTION_LAYOUTS = Object.freeze({ header: new Set(['default', 'showcase']), catalog: new Set(['grid', 'compact']), footer: new Set(['lanzo']) });
const SECTION_PROP_KEYS = Object.freeze({ header: new Set(['contentSource']), catalog: new Set(['showSearch', 'showCategories']), footer: new Set(['contentSource']) });
const HTTPS_URL = /^https:\/\/\S{1,2040}$/i;

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const keysSafe = (value, allowed) => isRecord(value) && Object.keys(value).every((key) => allowed.has(key) && !DANGEROUS_KEYS.has(key));
const byteLength = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
const clone = (value) => JSON.parse(JSON.stringify(value));
const validUrl = (value) => {
  if (value === null) return true;
  if (typeof value !== 'string' || value.length > 2048 || !HTTPS_URL.test(value) || [...value].some((character) => character.charCodeAt(0) < 32)) return false;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
};

export const defaultLayoutForTemplate = (templateCode) => {
  if (templateCode === 'showcase') return { header: 'showcase', catalog: 'grid', density: 'comfortable' };
  if (templateCode === 'compact') return { header: 'default', catalog: 'compact', density: 'compact' };
  return { header: 'default', catalog: 'grid', density: 'comfortable' };
};

export const createDefaultEcommerceSiteDocument = ({ templateCode = 'classic', theme, logoUrl = null, coverImageUrl = null } = {}) => {
  const normalizedTemplate = normalizeEcommercePortalTemplate(templateCode);
  const preset = defaultLayoutForTemplate(normalizedTemplate);
  return {
    schemaVersion: 2,
    global: {
      contentWidth: 'standard', density: preset.density,
      appearance: { templateCode: normalizedTemplate, theme: normalizeEcommercePortalTheme(theme || getEcommercePortalThemeDefaults()), branding: { logoUrl: validUrl(logoUrl) ? logoUrl : null, coverImageUrl: validUrl(coverImageUrl) ? coverImageUrl : null } }
    },
    sections: [
      { id: 'header-main', type: 'header', enabled: true, layout: preset.header, props: { contentSource: 'portal' } },
      { id: 'catalog-main', type: 'catalog', enabled: true, layout: preset.catalog, props: { showSearch: true, showCategories: true } },
      { id: 'footer-main', type: 'footer', enabled: true, layout: 'lanzo', props: { contentSource: 'lanzo' } }
    ]
  };
};

export function validateEcommerceSiteDocument(value, { requirePublishable = true } = {}) {
  try { if (byteLength(value) > MAX_DOCUMENT_BYTES) return { valid: false, code: 'ECOMMERCE_SITE_DOCUMENT_TOO_LARGE' }; } catch { return { valid: false, code: 'ECOMMERCE_SITE_DOCUMENT_INVALID' }; }
  if (!keysSafe(value, ROOT_KEYS)) return { valid: false, code: 'ECOMMERCE_SITE_DOCUMENT_INVALID' };
  if (value.schemaVersion !== 2) return { valid: false, code: 'ECOMMERCE_SITE_SCHEMA_UNSUPPORTED' };
  if (!keysSafe(value.global, GLOBAL_KEYS) || value.global.contentWidth !== 'standard' || !['comfortable', 'compact'].includes(value.global.density)) return { valid: false, code: 'ECOMMERCE_SITE_DOCUMENT_INVALID' };
  const appearance = value.global.appearance;
  if (!keysSafe(appearance, APPEARANCE_KEYS) || !['classic', 'showcase', 'compact'].includes(appearance.templateCode) || !keysSafe(appearance.theme, THEME_KEYS) || !keysSafe(appearance.branding, BRANDING_KEYS)) return { valid: false, code: 'ECOMMERCE_SITE_DOCUMENT_INVALID' };
  const { primaryColor, secondaryColor, cornerStyle, fontStyle } = appearance.theme;
  if (!/^#[0-9A-Fa-f]{6}$/.test(primaryColor) || !/^#[0-9A-Fa-f]{6}$/.test(secondaryColor) || !['rounded', 'soft', 'square'].includes(cornerStyle) || !['system', 'rounded', 'editorial'].includes(fontStyle) || !validUrl(appearance.branding.logoUrl) || !validUrl(appearance.branding.coverImageUrl)) return { valid: false, code: 'ECOMMERCE_SITE_DOCUMENT_INVALID' };
  if (!Array.isArray(value.sections) || value.sections.length > MAX_SECTIONS) return { valid: false, code: 'ECOMMERCE_SITE_DOCUMENT_INVALID' };
  const ids = new Set(); const activeTypes = new Map();
  for (const section of value.sections) {
    if (!keysSafe(section, new Set(['id', 'type', 'enabled', 'layout', 'props'])) || typeof section.id !== 'string' || !/^[a-z][a-z0-9-]{2,63}$/.test(section.id) || ids.has(section.id)) return { valid: false, code: ids.has(section?.id) ? 'ECOMMERCE_SITE_DUPLICATE_SECTION' : 'ECOMMERCE_SITE_SECTION_INVALID' };
    ids.add(section.id);
    if (!SECTION_LAYOUTS[section.type]?.has(section.layout) || typeof section.enabled !== 'boolean' || !keysSafe(section.props, SECTION_PROP_KEYS[section.type])) return { valid: false, code: 'ECOMMERCE_SITE_SECTION_INVALID' };
    if ((section.type === 'header' && section.props.contentSource !== 'portal') || (section.type === 'footer' && section.props.contentSource !== 'lanzo') || (section.type === 'catalog' && (typeof section.props.showSearch !== 'boolean' || typeof section.props.showCategories !== 'boolean'))) return { valid: false, code: 'ECOMMERCE_SITE_SECTION_INVALID' };
    if (section.enabled) activeTypes.set(section.type, (activeTypes.get(section.type) || 0) + 1);
  }
  if (requirePublishable && ['header', 'catalog', 'footer'].some((type) => activeTypes.get(type) !== 1)) return { valid: false, code: 'ECOMMERCE_SITE_REQUIRED_SECTION_MISSING' };
  return { valid: true, document: clone(value) };
}

export function migrateEcommerceSiteDocument(value, options = {}) {
  const v2 = validateEcommerceSiteDocument(value);
  if (v2.valid) return v2.document;
  const appearance = options.appearance || { templateCode: options.templateCode, theme: options.theme, logoUrl: options.logoUrl, coverImageUrl: options.coverImageUrl };
  const base = createDefaultEcommerceSiteDocument(appearance);
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.global) || !Array.isArray(value.sections)) return base;
  const legacy = value;
  const candidate = { ...base, global: { ...base.global, density: ['comfortable', 'compact'].includes(legacy.global.density) ? legacy.global.density : base.global.density }, sections: legacy.sections.map((section) => ({ id: section?.id, type: section?.type, enabled: section?.enabled, layout: section?.layout, props: section?.props })) };
  const validation = validateEcommerceSiteDocument(candidate);
  return validation.valid ? validation.document : base;
}

export function normalizeEcommerceSiteDocument(value, options = {}) {
  return migrateEcommerceSiteDocument(value, options);
}

const canonicalize = (value) => Array.isArray(value) ? value.map(canonicalize) : !isRecord(value) ? value : Object.keys(value).sort().reduce((result, key) => { result[key] = canonicalize(value[key]); return result; }, {});
export const buildEcommerceSiteDocumentChecksum = (value) => { const canonical = JSON.stringify(canonicalize(normalizeEcommerceSiteDocument(value))); let hash = 2166136261; for (let index = 0; index < canonical.length; index += 1) { hash ^= canonical.charCodeAt(index); hash = Math.imul(hash, 16777619); } return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`; };
export const ecommerceSiteDocumentInternals = Object.freeze({ MAX_DOCUMENT_BYTES, MAX_SECTIONS, canonicalize, validUrl });
