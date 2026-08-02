import { describe, expect, it } from 'vitest';
import {
  buildEcommerceSiteDocumentChecksum,
  createDefaultEcommerceSiteDocument,
  migrateEcommerceSiteDocument,
  normalizeEcommerceSiteDocument,
  validateEcommerceSiteDocument
} from '../ecommerceSiteDocument';

describe('ecommerce site document', () => {
  it('creates a valid template-compatible default document', () => {
    expect(validateEcommerceSiteDocument(createDefaultEcommerceSiteDocument({ templateCode: 'showcase' }))).toMatchObject({ valid: true });
    expect(createDefaultEcommerceSiteDocument({ templateCode: 'compact' }).global.density).toBe('compact');
  });

  it.each([
    ['unsupported schema', (doc) => ({ ...doc, schemaVersion: 3 }), 'ECOMMERCE_SITE_SCHEMA_UNSUPPORTED'],
    ['root is not an object', () => [], 'ECOMMERCE_SITE_DOCUMENT_INVALID'],
    ['global missing', (doc) => ({ sections: doc.sections, schemaVersion: 2 }), 'ECOMMERCE_SITE_DOCUMENT_INVALID'],
    ['sections is not an array', (doc) => ({ ...doc, sections: {} }), 'ECOMMERCE_SITE_DOCUMENT_INVALID'],
    ['more than thirty sections', (doc) => ({ ...doc, sections: Array.from({ length: 31 }, (_, index) => ({ ...doc.sections[index % 3], id: `header-${index}` })) }), 'ECOMMERCE_SITE_DOCUMENT_INVALID'],
    ['duplicate id', (doc) => ({ ...doc, sections: [...doc.sections, { ...doc.sections[0] }] }), 'ECOMMERCE_SITE_DUPLICATE_SECTION'],
    ['invalid id', (doc) => ({ ...doc, sections: [{ ...doc.sections[0], id: 'bad id' }, ...doc.sections.slice(1)] }), 'ECOMMERCE_SITE_SECTION_INVALID'],
    ['unknown type', (doc) => ({ ...doc, sections: [{ ...doc.sections[0], type: 'script' }, ...doc.sections.slice(1)] }), 'ECOMMERCE_SITE_SECTION_INVALID'],
    ['unknown layout', (doc) => ({ ...doc, sections: [{ ...doc.sections[0], layout: 'freeform' }, ...doc.sections.slice(1)] }), 'ECOMMERCE_SITE_SECTION_INVALID'],
    ['missing enabled', (doc) => ({ ...doc, sections: [{ id: doc.sections[0].id, type: 'header', layout: 'default', props: { contentSource: 'portal' } }, ...doc.sections.slice(1)] }), 'ECOMMERCE_SITE_SECTION_INVALID'],
    ['props are not an object', (doc) => ({ ...doc, sections: [{ ...doc.sections[0], props: [] }, ...doc.sections.slice(1)] }), 'ECOMMERCE_SITE_SECTION_INVALID'],
    ['unknown section key', (doc) => ({ ...doc, sections: [{ ...doc.sections[0], html: '<script />' }, ...doc.sections.slice(1)] }), 'ECOMMERCE_SITE_SECTION_INVALID'],
    ['missing catalog', (doc) => ({ ...doc, sections: doc.sections.filter((section) => section.type !== 'catalog') }), 'ECOMMERCE_SITE_REQUIRED_SECTION_MISSING'],
    ['two headers', (doc) => ({ ...doc, sections: [...doc.sections, { ...doc.sections[0], id: 'header-alt' }] }), 'ECOMMERCE_SITE_REQUIRED_SECTION_MISSING'],
    ['disabled required section', (doc) => ({ ...doc, sections: [{ ...doc.sections[0], enabled: false }, ...doc.sections.slice(1)] }), 'ECOMMERCE_SITE_REQUIRED_SECTION_MISSING'],
    ['unknown appearance key', (doc) => ({ ...doc, global: { ...doc.global, appearance: { ...doc.global.appearance, css: 'body{}' } } }), 'ECOMMERCE_SITE_DOCUMENT_INVALID'],
    ['http logo URL', (doc) => ({ ...doc, global: { ...doc.global, appearance: { ...doc.global.appearance, branding: { ...doc.global.appearance.branding, logoUrl: 'http://example.com/logo.png' } } } }), 'ECOMMERCE_SITE_DOCUMENT_INVALID'],
    ['blob cover URL', (doc) => ({ ...doc, global: { ...doc.global, appearance: { ...doc.global.appearance, branding: { ...doc.global.appearance.branding, coverImageUrl: 'blob:preview' } } } }), 'ECOMMERCE_SITE_DOCUMENT_INVALID']
  ])('rejects %s', (_name, mutate, code) => {
    expect(validateEcommerceSiteDocument(mutate(createDefaultEcommerceSiteDocument()))).toMatchObject({ valid: false, code });
  });

  it('rejects dangerous keys and oversized arbitrary content', () => {
    const document = createDefaultEcommerceSiteDocument();
    expect(validateEcommerceSiteDocument({ ...document, constructor: 'x' })).toMatchObject({ valid: false });
    expect(validateEcommerceSiteDocument({ ...document, prototype: 'x' })).toMatchObject({ valid: false });
    expect(validateEcommerceSiteDocument({ ...document, sections: [{ ...document.sections[0], props: { contentSource: 'portal', javascript: 'alert(1)' } }, ...document.sections.slice(1)] })).toMatchObject({ valid: false });
    expect(validateEcommerceSiteDocument({ ...document, global: { ...document.global, note: 'x'.repeat(70 * 1024) } })).toMatchObject({ valid: false, code: 'ECOMMERCE_SITE_DOCUMENT_TOO_LARGE' });
  });

  it('is deterministic, strips corrupt input via fallback, and prepares future migrations', () => {
    const document = createDefaultEcommerceSiteDocument();
    expect(buildEcommerceSiteDocumentChecksum(document)).toBe(buildEcommerceSiteDocumentChecksum(JSON.parse(JSON.stringify(document))));
    expect(normalizeEcommerceSiteDocument({ __proto__: { polluted: true } }).sections).toHaveLength(3);
    expect(migrateEcommerceSiteDocument({ schemaVersion: 99 }).schemaVersion).toBe(2);
  });

  it('migrates valid v1 structure while incorporating the current identity', () => {
    const v1 = { schemaVersion: 1, global: { themeSource: 'portal', contentWidth: 'standard', density: 'compact' }, sections: createDefaultEcommerceSiteDocument().sections };
    const migrated = migrateEcommerceSiteDocument(v1, { templateCode: 'showcase', logoUrl: 'https://example.com/logo.png' });
    expect(migrated).toMatchObject({ schemaVersion: 2, global: { density: 'compact', appearance: { templateCode: 'showcase', branding: { logoUrl: 'https://example.com/logo.png' } } } });
    expect(validateEcommerceSiteDocument(migrated).valid).toBe(true);
  });

  it('includes all identity and structure fields in the checksum', () => {
    const document = createDefaultEcommerceSiteDocument();
    const checksum = buildEcommerceSiteDocumentChecksum(document);
    expect(buildEcommerceSiteDocumentChecksum({ ...document, global: { ...document.global, appearance: { ...document.global.appearance, theme: { ...document.global.appearance.theme, primaryColor: '#111111' } } } })).not.toBe(checksum);
    expect(buildEcommerceSiteDocumentChecksum({ ...document, global: { ...document.global, appearance: { ...document.global.appearance, branding: { ...document.global.appearance.branding, logoUrl: 'https://example.com/logo.png' } } } })).not.toBe(checksum);
  });
});
