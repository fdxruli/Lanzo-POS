const MAX_DOCUMENT_BYTES = 64 * 1024;
const MAX_SECTIONS = 30;
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const SECTION_LAYOUTS = Object.freeze({
  header: new Set(['default', 'showcase']),
  catalog: new Set(['grid', 'compact']),
  footer: new Set(['lanzo'])
});
const SECTION_PROP_KEYS = Object.freeze({
  header: new Set(['contentSource']),
  catalog: new Set(['showSearch', 'showCategories']),
  footer: new Set(['contentSource'])
});

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const hasOnly = (value, allowed) => Object.keys(value).every((key) => allowed.has(key));
const byteLength = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
const clone = (value) => JSON.parse(JSON.stringify(value));

const defaultLayoutForTemplate = (templateCode) => {
  if (templateCode === 'showcase') return { header: 'showcase', catalog: 'grid', density: 'comfortable' };
  if (templateCode === 'compact') return { header: 'default', catalog: 'compact', density: 'compact' };
  return { header: 'default', catalog: 'grid', density: 'comfortable' };
};

export const createDefaultEcommerceSiteDocument = ({ templateCode = 'classic' } = {}) => {
  const preset = defaultLayoutForTemplate(templateCode);
  return {
    schemaVersion: 1,
    global: { themeSource: 'portal', contentWidth: 'standard', density: preset.density },
    sections: [
      { id: 'header-main', type: 'header', enabled: true, layout: preset.header, props: { contentSource: 'portal' } },
      { id: 'catalog-main', type: 'catalog', enabled: true, layout: preset.catalog, props: { showSearch: true, showCategories: true } },
      { id: 'footer-main', type: 'footer', enabled: true, layout: 'lanzo', props: { contentSource: 'lanzo' } }
    ]
  };
};

export function validateEcommerceSiteDocument(value, { requirePublishable = true } = {}) {
  if (!isRecord(value) || !hasOnly(value, new Set(['schemaVersion', 'global', 'sections']))) {
    return { valid: false, code: 'ECOMMERCE_SITE_DOCUMENT_INVALID' };
  }
  if (value.schemaVersion !== 1) return { valid: false, code: 'ECOMMERCE_SITE_SCHEMA_UNSUPPORTED' };
  if (!Array.isArray(value.sections) || value.sections.length > MAX_SECTIONS) {
    return { valid: false, code: 'ECOMMERCE_SITE_DOCUMENT_INVALID' };
  }
  if (!isRecord(value.global) || !hasOnly(value.global, new Set(['themeSource', 'contentWidth', 'density']))
    || value.global.themeSource !== 'portal'
    || value.global.contentWidth !== 'standard'
    || !['comfortable', 'compact'].includes(value.global.density)) {
    return { valid: false, code: 'ECOMMERCE_SITE_DOCUMENT_INVALID' };
  }
  const ids = new Set();
  const activeTypes = new Map();
  for (const section of value.sections) {
    if (!isRecord(section) || !hasOnly(section, new Set(['id', 'type', 'enabled', 'layout', 'props', 'style']))) {
      return { valid: false, code: 'ECOMMERCE_SITE_SECTION_INVALID' };
    }
    if (Object.keys(section).some((key) => DANGEROUS_KEYS.has(key))
      || typeof section.id !== 'string' || !/^[a-z][a-z0-9-]{2,63}$/.test(section.id)
      || ids.has(section.id)) {
      return { valid: false, code: ids.has(section.id) ? 'ECOMMERCE_SITE_DUPLICATE_SECTION' : 'ECOMMERCE_SITE_SECTION_INVALID' };
    }
    ids.add(section.id);
    if (!SECTION_LAYOUTS[section.type] || !SECTION_LAYOUTS[section.type].has(section.layout)
      || typeof section.enabled !== 'boolean' || !isRecord(section.props)
      || !hasOnly(section.props, SECTION_PROP_KEYS[section.type])) {
      return { valid: false, code: 'ECOMMERCE_SITE_SECTION_INVALID' };
    }
    if (section.style !== undefined && (!isRecord(section.style) || Object.keys(section.style).length > 0)) {
      return { valid: false, code: 'ECOMMERCE_SITE_SECTION_INVALID' };
    }
    if ((section.type === 'header' || section.type === 'footer')
      && section.props.contentSource !== (section.type === 'header' ? 'portal' : 'lanzo')) {
      return { valid: false, code: 'ECOMMERCE_SITE_SECTION_INVALID' };
    }
    if (section.type === 'catalog' && (typeof section.props.showSearch !== 'boolean' || typeof section.props.showCategories !== 'boolean')) {
      return { valid: false, code: 'ECOMMERCE_SITE_SECTION_INVALID' };
    }
    if (section.enabled) activeTypes.set(section.type, (activeTypes.get(section.type) || 0) + 1);
  }
  if (requirePublishable && ['header', 'catalog', 'footer'].some((type) => activeTypes.get(type) !== 1)) {
    return { valid: false, code: 'ECOMMERCE_SITE_REQUIRED_SECTION_MISSING' };
  }
  try {
    if (byteLength(value) > MAX_DOCUMENT_BYTES) return { valid: false, code: 'ECOMMERCE_SITE_DOCUMENT_TOO_LARGE' };
  } catch {
    return { valid: false, code: 'ECOMMERCE_SITE_DOCUMENT_INVALID' };
  }
  return { valid: true, document: clone(value) };
}

export function normalizeEcommerceSiteDocument(value, options = {}) {
  const validation = validateEcommerceSiteDocument(value, options);
  return validation.valid ? validation.document : createDefaultEcommerceSiteDocument(options);
}

export function migrateEcommerceSiteDocument(value, options = {}) {
  if (isRecord(value) && value.schemaVersion === 1) return normalizeEcommerceSiteDocument(value, options);
  return createDefaultEcommerceSiteDocument(options);
}

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalize(value[key]);
    return result;
  }, {});
};

export const buildEcommerceSiteDocumentChecksum = (value) => {
  const canonical = JSON.stringify(canonicalize(normalizeEcommerceSiteDocument(value)));
  let hash = 2166136261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

export const ecommerceSiteDocumentInternals = Object.freeze({ MAX_DOCUMENT_BYTES, MAX_SECTIONS, canonicalize });
