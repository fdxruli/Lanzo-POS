export const ECOMMERCE_PORTAL_TEMPLATES = Object.freeze(['classic', 'showcase', 'compact']);
export const ECOMMERCE_PORTAL_CORNER_STYLES = Object.freeze(['rounded', 'soft', 'square']);
export const ECOMMERCE_PORTAL_FONT_STYLES = Object.freeze(['system', 'rounded', 'editorial']);

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_THEME = Object.freeze({
  primaryColor: '#0284c7',
  secondaryColor: '#0369a1',
  cornerStyle: 'rounded',
  fontStyle: 'system'
});

const fontStacks = Object.freeze({
  system: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  rounded: 'ui-rounded, "Arial Rounded MT Bold", system-ui, sans-serif',
  editorial: 'Georgia, Cambria, "Times New Roman", serif'
});

const radiusStyles = Object.freeze({
  rounded: ['1rem', '0.75rem'],
  soft: ['0.5rem', '0.375rem'],
  square: ['0', '0']
});

export const isEcommercePortalHexColor = (value) => HEX_COLOR.test(String(value || ''));

export const getEcommercePortalThemeDefaults = () => ({ ...DEFAULT_THEME });

export const normalizeEcommercePortalTemplate = (value) => (
  ECOMMERCE_PORTAL_TEMPLATES.includes(value) ? value : 'classic'
);

export const normalizeEcommercePortalTheme = (value) => {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    primaryColor: isEcommercePortalHexColor(input.primaryColor)
      ? input.primaryColor.toLowerCase() : DEFAULT_THEME.primaryColor,
    secondaryColor: isEcommercePortalHexColor(input.secondaryColor)
      ? input.secondaryColor.toLowerCase() : DEFAULT_THEME.secondaryColor,
    cornerStyle: ECOMMERCE_PORTAL_CORNER_STYLES.includes(input.cornerStyle)
      ? input.cornerStyle : DEFAULT_THEME.cornerStyle,
    fontStyle: ECOMMERCE_PORTAL_FONT_STYLES.includes(input.fontStyle)
      ? input.fontStyle : DEFAULT_THEME.fontStyle
  };
};

const mixHex = (hex, target, ratio) => {
  const source = hex.slice(1);
  const to = target.slice(1);
  const channels = [0, 2, 4].map((offset) => Math.round(
    Number.parseInt(source.slice(offset, offset + 2), 16) * (1 - ratio)
      + Number.parseInt(to.slice(offset, offset + 2), 16) * ratio
  ).toString(16).padStart(2, '0'));
  return `#${channels.join('')}`;
};

const readableText = (hex) => {
  const rgb = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const luminance = rgb.map((channel) => (
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  )).reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
  return luminance > 0.179 ? '#0f172a' : '#ffffff';
};

export const buildEcommercePortalThemeStyle = (value) => {
  const theme = normalizeEcommercePortalTheme(value);
  const [cardRadius, buttonRadius] = radiusStyles[theme.cornerStyle];
  return {
    '--store-primary': theme.primaryColor,
    '--store-primary-hover': mixHex(theme.primaryColor, '#000000', 0.14),
    '--store-secondary': theme.secondaryColor,
    '--store-on-primary': readableText(theme.primaryColor),
    '--store-radius-card': cardRadius,
    '--store-radius-button': buttonRadius,
    '--store-font-family': fontStacks[theme.fontStyle]
  };
};
