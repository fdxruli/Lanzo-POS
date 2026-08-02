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

export const setDocumentAppearance = (document, appearance) => updateDocument(document, (current) => ({
  ...current,
  global: { ...current.global, appearance: { ...current.global.appearance, ...appearance } }
}));

export const setDocumentTheme = (document, theme) => updateDocument(document, (current) => ({
  ...current,
  global: { ...current.global, appearance: { ...current.global.appearance, theme: { ...current.global.appearance.theme, ...theme } } }
}));

export const setDocumentBranding = (document, branding) => updateDocument(document, (current) => ({
  ...current,
  global: { ...current.global, appearance: { ...current.global.appearance, branding: { ...current.global.appearance.branding, ...branding } } }
}));

export const changeDocumentTemplate = (document, templateCode) => {
  const current = normalizeEcommerceSiteDocument(document);
  const preset = createDefaultEcommerceSiteDocument({ templateCode });
  return updateDocument(current, (value) => ({
    ...value,
    global: { ...value.global, density: preset.global.density, appearance: { ...value.global.appearance, templateCode: preset.global.appearance.templateCode } },
    sections: value.sections.map((section) => {
      const presetSection = preset.sections.find((item) => item.type === section.type);
      return presetSection ? { ...section, layout: presetSection.layout } : section;
    })
  }));
};

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

export const resetDocumentToPreset = (document, templateCode) => {
  const current = normalizeEcommerceSiteDocument(document);
  // Reset restores design defaults but deliberately preserves uploaded logo and cover.
  return createDefaultEcommerceSiteDocument({
    templateCode,
    logoUrl: current.global.appearance.branding.logoUrl,
    coverImageUrl: current.global.appearance.branding.coverImageUrl
  });
};
