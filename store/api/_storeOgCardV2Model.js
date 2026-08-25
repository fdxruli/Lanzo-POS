import {
  normalizePublicPortalTemplate,
  normalizePublicPortalTheme,
} from './_portalTheme.js';
import {
  normalizeSocialText,
  truncateSocialText,
} from './_socialMetadata.js';

const FALLBACK_NAME = 'Tienda en línea';
const FALLBACK_DESCRIPTION = 'Consulta productos y realiza tu pedido con Lanzo.';
const LABEL = 'Tienda en línea';
const POWERED_BY = 'Impulsado por Lanzo';
const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 180;
const MAX_IMAGE_URL_LENGTH = 2_048;
const DARK_TEXT = '#0f172a';
const LIGHT_TEXT = '#ffffff';
const DARK_MIX_TARGET = '#020617';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function parseHex(hex) {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

function colorLuminance(hex) {
  const channels = parseHex(hex).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function readableTextColor(hex) {
  return colorLuminance(hex) > 0.42 ? DARK_TEXT : LIGHT_TEXT;
}

function mixColor(hex, target, ratio) {
  const sourceChannels = parseHex(hex);
  const targetChannels = parseHex(target);
  const channels = sourceChannels.map((channel, index) => (
    Math.round(channel * (1 - ratio) + targetChannels[index] * ratio)
      .toString(16)
      .padStart(2, '0')
  ));
  return `#${channels.join('')}`;
}

function rgba(hex, alpha) {
  return `rgba(${parseHex(hex).join(',')},${alpha})`;
}

function areColorsTooSimilar(left, right) {
  const leftChannels = parseHex(left);
  const rightChannels = parseHex(right);
  const maximumChannelDelta = Math.max(
    ...leftChannels.map((channel, index) => Math.abs(channel - rightChannels[index])),
  );
  return maximumChannelDelta < 28
    || Math.abs(colorLuminance(left) - colorLuminance(right)) < 0.035;
}

function normalizeImageUrl(value) {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > MAX_IMAGE_URL_LENGTH) return null;

  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function titleSizeFor(name) {
  const length = Array.from(name).length;
  if (length <= 20) return 76;
  if (length <= 36) return 68;
  if (length <= 56) return 60;
  return 52;
}

function logoSizeFor(templateCode) {
  if (templateCode === 'compact') return 132;
  if (templateCode === 'showcase') return 148;
  return 142;
}

function surfaceColorFor(backgroundColor, accentColor) {
  if (!areColorsTooSimilar(backgroundColor, accentColor)) return backgroundColor;
  const target = readableTextColor(backgroundColor) === LIGHT_TEXT
    ? LIGHT_TEXT
    : DARK_MIX_TARGET;
  return mixColor(backgroundColor, target, 0.18);
}

function buildVisualTokens(theme, templateCode, name) {
  const backgroundColor = theme.secondaryColor;
  const accentColor = theme.primaryColor;
  const surfaceColor = surfaceColorFor(backgroundColor, accentColor);
  const textOnBackground = readableTextColor(backgroundColor);
  const textOnSurface = readableTextColor(surfaceColor);
  const textOnAccent = readableTextColor(accentColor);
  const accentSoftTarget = textOnBackground === LIGHT_TEXT ? LIGHT_TEXT : DARK_TEXT;
  const accentSoftColor = mixColor(accentColor, accentSoftTarget, 0.76);
  const mutedTextColor = mixColor(textOnBackground, backgroundColor, 0.34);
  const overlayBase = mixColor(backgroundColor, DARK_MIX_TARGET, 0.58);

  return {
    backgroundColor,
    surfaceColor,
    accentColor,
    accentSoftColor,
    textOnBackground,
    textOnSurface,
    textOnAccent,
    mutedTextColor,
    overlayColor: rgba(overlayBase, 0.82),
    cornerStyle: theme.cornerStyle,
    titleSize: titleSizeFor(name),
    logoSize: logoSizeFor(templateCode),
  };
}

export function buildStoreOgCardV2Model(input = {}) {
  const safeInput = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const templateCode = normalizePublicPortalTemplate(safeInput.templateCode);
  const theme = normalizePublicPortalTheme(safeInput.theme);
  const name = truncateSocialText(safeInput.name, MAX_NAME_LENGTH) || FALLBACK_NAME;
  const shortDescription = truncateSocialText(
    normalizeSocialText(safeInput.headline) || normalizeSocialText(safeInput.description),
    MAX_DESCRIPTION_LENGTH,
  ) || FALLBACK_DESCRIPTION;

  return deepFreeze({
    version: 2,
    content: {
      name,
      shortDescription,
      label: LABEL,
    },
    branding: {
      logoUrl: normalizeImageUrl(safeInput.logoUrl),
      coverImageUrl: normalizeImageUrl(safeInput.coverImageUrl),
      poweredBy: POWERED_BY,
    },
    layout: {
      templateCode,
      variant: templateCode,
    },
    visual: buildVisualTokens(theme, templateCode, name),
  });
}
