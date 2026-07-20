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
    ['unsupported schema', (doc) => ({ ...doc, schemaVersion: 2 }), 'ECOMMERCE_SITE_SCHEMA_UNSUPPORTED'],
    ['root is not an object', () => [], 'ECOMMERCE_SITE_DOCUMENT_INVALID'],
    ['global missing', (doc) => ({ sections: doc.sections, schemaVersion: 1 }), 'ECOMMERCE_SITE_DOCUMENT_INVALID'],
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
    ['unsafe style', (doc) => ({ ...doc, sections: [{ ...doc.sections[0], style: { css: 'body{}' } }, ...doc.sections.slice(1)] }), 'ECOMMERCE_SITE_SECTION_INVALID']
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
    expect(migrateEcommerceSiteDocument({ schemaVersion: 99 }).schemaVersion).toBe(1);
  });
});
