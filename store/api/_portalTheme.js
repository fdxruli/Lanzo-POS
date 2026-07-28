export const PUBLIC_PORTAL_TEMPLATES = Object.freeze(['classic', 'showcase', 'compact']);
export const PUBLIC_PORTAL_CORNER_STYLES = Object.freeze(['rounded', 'soft', 'square']);
export const PUBLIC_PORTAL_FONT_STYLES = Object.freeze(['system', 'rounded', 'editorial']);

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/u;
const DEFAULT_THEME = Object.freeze({
  primaryColor: '#0284c7',
  secondaryColor: '#0369a1',
  cornerStyle: 'rounded',
  fontStyle: 'system',
});

export const isPublicPortalHexColor = (value) => HEX_COLOR.test(String(value || ''));

export const normalizePublicPortalTemplate = (value) => (
  PUBLIC_PORTAL_TEMPLATES.includes(value) ? value : 'classic'
);

export const normalizePublicPortalTheme = (value) => {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    primaryColor: isPublicPortalHexColor(input.primaryColor)
      ? input.primaryColor.toLowerCase() : DEFAULT_THEME.primaryColor,
    secondaryColor: isPublicPortalHexColor(input.secondaryColor)
      ? input.secondaryColor.toLowerCase() : DEFAULT_THEME.secondaryColor,
    cornerStyle: PUBLIC_PORTAL_CORNER_STYLES.includes(input.cornerStyle)
      ? input.cornerStyle : DEFAULT_THEME.cornerStyle,
    fontStyle: PUBLIC_PORTAL_FONT_STYLES.includes(input.fontStyle)
      ? input.fontStyle : DEFAULT_THEME.fontStyle,
  };
};
