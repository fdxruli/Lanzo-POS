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
    ['duplicate id', (doc) => ({ ...doc, sections: [...doc.sections, { ...doc.sections[0] }] }), 'ECOMMERCE_SITE_DUPLICATE_SECTION'],
    ['unknown type', (doc) => ({ ...doc, sections: [{ ...doc.sections[0], type: 'script' }, ...doc.sections.slice(1)] }), 'ECOMMERCE_SITE_SECTION_INVALID'],
    ['missing catalog', (doc) => ({ ...doc, sections: doc.sections.filter((section) => section.type !== 'catalog') }), 'ECOMMERCE_SITE_REQUIRED_SECTION_MISSING'],
    ['unsafe style', (doc) => ({ ...doc, sections: [{ ...doc.sections[0], style: { css: 'body{}' } }, ...doc.sections.slice(1)] }), 'ECOMMERCE_SITE_SECTION_INVALID']
  ])('rejects %s', (_name, mutate, code) => {
    expect(validateEcommerceSiteDocument(mutate(createDefaultEcommerceSiteDocument()))).toMatchObject({ valid: false, code });
  });

  it('is deterministic, strips corrupt input via fallback, and prepares future migrations', () => {
    const document = createDefaultEcommerceSiteDocument();
    expect(buildEcommerceSiteDocumentChecksum(document)).toBe(buildEcommerceSiteDocumentChecksum(JSON.parse(JSON.stringify(document))));
    expect(normalizeEcommerceSiteDocument({ __proto__: { polluted: true } }).sections).toHaveLength(3);
    expect(migrateEcommerceSiteDocument({ schemaVersion: 99 }).schemaVersion).toBe(1);
  });
});
