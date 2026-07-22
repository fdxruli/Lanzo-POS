import {
  createDefaultEcommerceSiteDocument,
  normalizeEcommerceSiteDocument,
  validateEcommerceSiteDocument
} from './ecommerceSiteDocument';

const updateDocument = (document, updater) => {
  const current = normalizeEcommerceSiteDocument(document);
  const next = updater(current);
  const validation = validateEcommerceSiteDocument(next);
  return validation.valid ? validation.document : current;
};

export const setGlobalDensity = (document, density) => updateDocument(document, (current) => ({
  ...current,
  global: { ...current.global, density }
}));

export const setSectionLayout = (document, sectionType, layout) => updateDocument(document, (current) => ({
  ...current,
  sections: current.sections.map((section) => (
    section.type === sectionType ? { ...section, layout } : section
  ))
}));

export const setCatalogVisibility = (document, property, visible) => updateDocument(document, (current) => ({
  ...current,
  sections: current.sections.map((section) => (
    section.type === 'catalog'
      ? { ...section, props: { ...section.props, [property]: visible } }
      : section
  ))
}));

export const moveSection = (document, sectionId, direction) => updateDocument(document, (current) => {
  const index = current.sections.findIndex((section) => section.id === sectionId);
  const nextIndex = direction === 'up' ? index - 1 : direction === 'down' ? index + 1 : index;
  if (index < 0 || nextIndex < 0 || nextIndex >= current.sections.length || nextIndex === index) return current;
  const sections = [...current.sections];
  [sections[index], sections[nextIndex]] = [sections[nextIndex], sections[index]];
  return { ...current, sections };
});

export const resetDocumentToPreset = (_document, templateCode) => (
  createDefaultEcommerceSiteDocument({ templateCode })
);
