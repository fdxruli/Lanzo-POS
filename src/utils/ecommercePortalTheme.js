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
const DEFAULT_DARK_TEXT = '#000000';
const WHITE = '#ffffff';

const fontStacks = Object.freeze({
  system: {
    body: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    heading: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  },
  rounded: {
    body: 'ui-rounded, "Arial Rounded MT Bold", system-ui, sans-serif',
    heading: 'ui-rounded, "Arial Rounded MT Bold", system-ui, sans-serif'
  },
  editorial: {
    body: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    heading: 'Georgia, Cambria, "Times New Roman", serif'
  }
});

const radiusStyles = Object.freeze({
  rounded: { card: '1rem', button: '0.75rem', media: '0.875rem', panel: '1.25rem' },
  soft: { card: '0.5rem', button: '0.375rem', media: '0.5rem', panel: '0.75rem' },
  square: { card: '0', button: '0', media: '0', panel: '0' }
});

const templateProfiles = Object.freeze({
  classic: {
    page: '#f8fafc', surface: '#ffffff', muted: '#f1f5f9',
    shadowCard: '0 8px 20px -16px rgba(15, 23, 42, 0.32)',
    shadowElevated: '0 18px 42px -25px rgba(15, 23, 42, 0.34)',
    shadowFloating: '0 20px 48px -22px rgba(15, 23, 42, 0.42)',
    sectionGap: '2rem', gridGap: '1rem', coverHeight: 'clamp(12rem, 36cqi, 23rem)'
  },
  showcase: {
    page: '#f8fafc', surface: '#ffffff', muted: '#f1f5f9',
    shadowCard: '0 18px 34px -22px rgba(15, 23, 42, 0.38)',
    shadowElevated: '0 26px 58px -28px rgba(15, 23, 42, 0.46)',
    shadowFloating: '0 28px 60px -25px rgba(15, 23, 42, 0.5)',
    sectionGap: '3rem', gridGap: '1.35rem', coverHeight: 'clamp(18rem, 48cqi, 31rem)'
  },
  compact: {
    page: '#ffffff', surface: '#ffffff', muted: '#f8fafc',
    shadowCard: '0 2px 8px -7px rgba(15, 23, 42, 0.35)',
    shadowElevated: '0 8px 20px -16px rgba(15, 23, 42, 0.34)',
    shadowFloating: '0 12px 28px -18px rgba(15, 23, 42, 0.4)',
    sectionGap: '1.25rem', gridGap: '0.65rem', coverHeight: 'clamp(9rem, 28cqi, 15rem)'
  }
});

export const isEcommercePortalHexColor = (value) => HEX_COLOR.test(String(value || ''));

export const hexToRgb = (value) => {
  if (!isEcommercePortalHexColor(value)) return null;
  const hex = value.slice(1);
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16)
  };
};

export const relativeLuminance = (value) => {
  const rgb = typeof value === 'string' ? hexToRgb(value) : value;
  if (!rgb || ![rgb.r, rgb.g, rgb.b].every((channel) => Number.isFinite(channel))) return null;
  const linear = [rgb.r, rgb.g, rgb.b].map((channel) => {
    const normalized = Math.min(255, Math.max(0, channel)) / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
};

export const contrastRatio = (foreground, background) => {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  if (foregroundLuminance === null || backgroundLuminance === null) return 0;
  const [light, dark] = [foregroundLuminance, backgroundLuminance].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
};

export const normalizeEcommercePortalColor = (value, fallback = DEFAULT_THEME.primaryColor) => (
  isEcommercePortalHexColor(value) ? value.toLowerCase() : fallback
);

export const mixEcommercePortalColors = (source, target, ratio) => {
  const safeSource = normalizeEcommercePortalColor(source);
  const safeTarget = normalizeEcommercePortalColor(target, WHITE);
  const safeRatio = Number.isFinite(Number(ratio)) ? Math.min(1, Math.max(0, Number(ratio))) : 0;
  const from = hexToRgb(safeSource);
  const to = hexToRgb(safeTarget);
  const toHex = (channel) => Math.round(channel).toString(16).padStart(2, '0');
  return `#${['r', 'g', 'b'].map((channel) => toHex(from[channel] * (1 - safeRatio) + to[channel] * safeRatio)).join('')}`;
};

export const selectAccessibleTextColor = (background) => {
  const safeBackground = normalizeEcommercePortalColor(background);
  return contrastRatio(WHITE, safeBackground) >= contrastRatio(DEFAULT_DARK_TEXT, safeBackground)
    ? WHITE : DEFAULT_DARK_TEXT;
};

export const deriveAccessibleBrandTextColor = ({
  color,
  background,
  minimumContrast = 4.5
} = {}) => {
  const safeColor = normalizeEcommercePortalColor(color);
  const safeBackground = normalizeEcommercePortalColor(background, '#ffffff');
  const minimum = Number.isFinite(Number(minimumContrast)) ? Math.max(1, Number(minimumContrast)) : 4.5;
  if (contrastRatio(safeColor, safeBackground) >= minimum) return safeColor;
  for (let step = 1; step <= 24; step += 1) {
    const candidate = mixEcommercePortalColors(safeColor, '#000000', step / 24);
    if (contrastRatio(candidate, safeBackground) >= minimum) return candidate;
  }
  return '#000000';
};

export const deriveAccessibleFocusColor = ({
  color,
  surfaces = [],
  minimumContrast = 3
} = {}) => {
  const safeColor = normalizeEcommercePortalColor(color);
  const safeSurfaces = (Array.isArray(surfaces) ? surfaces : [])
    .map((surface) => normalizeEcommercePortalColor(surface, '#ffffff'));
  const targets = safeSurfaces.length ? safeSurfaces : ['#ffffff'];
  const minimum = Number.isFinite(Number(minimumContrast)) ? Math.max(1, Number(minimumContrast)) : 3;
  for (let step = 0; step <= 24; step += 1) {
    const candidate = mixEcommercePortalColors(safeColor, '#000000', step / 24);
    if (targets.every((surface) => contrastRatio(candidate, surface) >= minimum)) return candidate;
  }
  return '#000000';
};

export const getEcommercePortalThemeDefaults = () => ({ ...DEFAULT_THEME });

export const normalizeEcommercePortalTemplate = (value) => (
  ECOMMERCE_PORTAL_TEMPLATES.includes(value) ? value : 'classic'
);

export const normalizeEcommercePortalTheme = (value) => {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    primaryColor: normalizeEcommercePortalColor(input.primaryColor, DEFAULT_THEME.primaryColor),
    secondaryColor: normalizeEcommercePortalColor(input.secondaryColor, DEFAULT_THEME.secondaryColor),
    cornerStyle: ECOMMERCE_PORTAL_CORNER_STYLES.includes(input.cornerStyle)
      ? input.cornerStyle : DEFAULT_THEME.cornerStyle,
    fontStyle: ECOMMERCE_PORTAL_FONT_STYLES.includes(input.fontStyle)
      ? input.fontStyle : DEFAULT_THEME.fontStyle
  };
};

const normalizeDensity = (value) => value === 'compact' ? 'compact' : 'comfortable';
const normalizeContentWidth = (value) => value === 'standard' ? value : 'standard';

export const buildEcommerceSiteDesignStyle = ({ theme, templateCode, density, contentWidth } = {}) => {
  const normalizedTheme = normalizeEcommercePortalTheme(theme);
  const normalizedTemplate = normalizeEcommercePortalTemplate(templateCode);
  const normalizedDensity = normalizeDensity(density);
  const normalizedContentWidth = normalizeContentWidth(contentWidth);
  const profile = templateProfiles[normalizedTemplate];
  const radii = radiusStyles[normalizedTheme.cornerStyle];
  const fonts = fontStacks[normalizedTheme.fontStyle];
  const compact = normalizedDensity === 'compact';
  const primary = normalizedTheme.primaryColor;
  const secondary = normalizedTheme.secondaryColor;
  const pageBackground = normalizedTemplate === 'showcase'
    ? mixEcommercePortalColors(secondary, '#ffffff', 0.96) : profile.page;
  const surface = profile.surface;

  return {
    '--store-primary': primary,
    '--store-primary-hover': mixEcommercePortalColors(primary, '#000000', 0.14),
    '--store-primary-active': mixEcommercePortalColors(primary, '#000000', 0.24),
    '--store-primary-soft': mixEcommercePortalColors(primary, '#ffffff', 0.9),
    '--store-secondary': secondary,
    '--store-secondary-hover': mixEcommercePortalColors(secondary, '#000000', 0.14),
    '--store-secondary-soft': mixEcommercePortalColors(secondary, '#ffffff', 0.9),
    '--store-on-primary': selectAccessibleTextColor(primary),
    '--store-on-secondary': selectAccessibleTextColor(secondary),
    '--store-page-bg': pageBackground,
    '--store-surface': surface,
    '--store-surface-elevated': '#ffffff',
    '--store-surface-muted': profile.muted,
    '--store-surface-brand-soft': mixEcommercePortalColors(primary, '#ffffff', normalizedTemplate === 'showcase' ? 0.85 : 0.92),
    '--store-text': '#334155',
    '--store-text-strong': '#0f172a',
    '--store-text-muted': '#64748b',
    '--store-text-brand': deriveAccessibleBrandTextColor({ color: primary, background: surface }),
    '--store-text-secondary': deriveAccessibleBrandTextColor({ color: secondary, background: surface }),
    '--store-border': '#e2e8f0',
    '--store-border-strong': mixEcommercePortalColors(primary, '#0f172a', 0.34),
    '--store-focus-ring': deriveAccessibleFocusColor({
      color: primary,
      surfaces: [surface, pageBackground]
    }),
    '--store-font-body': fonts.body,
    '--store-font-heading': fonts.heading,
    '--store-font-family': fonts.body,
    '--store-radius-card': radii.card,
    '--store-radius-button': radii.button,
    '--store-radius-media': radii.media,
    '--store-radius-panel': radii.panel,
    '--store-shadow-card': profile.shadowCard,
    '--store-shadow-elevated': profile.shadowElevated,
    '--store-shadow-floating': profile.shadowFloating,
    '--store-content-max': normalizedContentWidth === 'standard' ? '72rem' : '72rem',
    '--store-page-padding': compact ? '0.75rem' : '1rem',
    '--store-section-gap': compact ? '1rem' : profile.sectionGap,
    '--store-grid-gap': compact ? '0.65rem' : profile.gridGap,
    '--store-card-padding': compact ? '0.75rem' : normalizedTemplate === 'showcase' ? '1.2rem' : '1rem',
    '--store-header-cover-height': compact ? 'clamp(9rem, 28cqi, 15rem)' : profile.coverHeight
  };
};

// This legacy API deliberately keeps its compact contract for tracking and the existing customization panel.
export const buildEcommercePortalThemeStyle = (value) => {
  const theme = normalizeEcommercePortalTheme(value);
  const radii = radiusStyles[theme.cornerStyle];
  const fonts = fontStacks[theme.fontStyle];
  return {
    '--store-primary': theme.primaryColor,
    '--store-primary-hover': mixEcommercePortalColors(theme.primaryColor, '#000000', 0.14),
    '--store-secondary': theme.secondaryColor,
    '--store-on-primary': selectAccessibleTextColor(theme.primaryColor),
    '--store-radius-card': radii.card,
    '--store-radius-button': radii.button,
    '--store-font-family': theme.fontStyle === 'editorial' ? fonts.heading : fonts.body
  };
};
