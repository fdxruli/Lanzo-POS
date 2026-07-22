import { describe, expect, it } from 'vitest';
import { createDefaultEcommerceSiteDocument, validateEcommerceSiteDocument } from '../ecommerceSiteDocument';
import { moveSection, resetDocumentToPreset, setCatalogVisibility, setGlobalDensity, setSectionLayout } from '../ecommerceSiteBuilderDocument';

describe('ecommerceSiteBuilderDocument', () => {
  it('edits every allowed field immutably and keeps a valid document', () => {
    const original = createDefaultEcommerceSiteDocument();
    const density = setGlobalDensity(original, 'compact');
    const header = setSectionLayout(density, 'header', 'showcase');
    const catalog = setSectionLayout(header, 'catalog', 'compact');
    const search = setCatalogVisibility(catalog, 'showSearch', false);
    const categories = setCatalogVisibility(search, 'showCategories', false);
    expect(original.global.density).toBe('comfortable');
    expect(density).not.toBe(original);
    expect(categories).toMatchObject({ global: { density: 'compact' } });
    expect(categories.sections.find(({ type }) => type === 'header').layout).toBe('showcase');
    expect(categories.sections.find(({ type }) => type === 'catalog')).toMatchObject({ layout: 'compact', props: { showSearch: false, showCategories: false } });
    expect(validateEcommerceSiteDocument(categories).valid).toBe(true);
  });

  it('moves sections within bounds while preserving ids, required props, and the original', () => {
    const original = createDefaultEcommerceSiteDocument();
    const unchangedTop = moveSection(original, 'header-main', 'up');
    const unchangedBottom = moveSection(original, 'footer-main', 'down');
    const moved = moveSection(original, 'catalog-main', 'up');
    expect(unchangedTop).toEqual(original);
    expect(unchangedBottom).toEqual(original);
    expect(original.sections.map(({ type }) => type)).toEqual(['header', 'catalog', 'footer']);
    expect(moved.sections.map(({ type }) => type)).toEqual(['catalog', 'header', 'footer']);
    expect(moved.sections.map(({ id }) => id).sort()).toEqual(original.sections.map(({ id }) => id).sort());
    expect(moved.sections.find(({ type }) => type === 'footer').props.contentSource).toBe('lanzo');
    expect(validateEcommerceSiteDocument(moved).valid).toBe(true);
  });

  it('resets to the selected portal preset without mutating the current document', () => {
    const current = setGlobalDensity(createDefaultEcommerceSiteDocument(), 'compact');
    const reset = resetDocumentToPreset(current, 'showcase');
    expect(reset.global.density).toBe('comfortable');
    expect(reset.sections.find(({ type }) => type === 'header').layout).toBe('showcase');
    expect(current.global.density).toBe('compact');
    expect(validateEcommerceSiteDocument(reset).valid).toBe(true);
  });
});
