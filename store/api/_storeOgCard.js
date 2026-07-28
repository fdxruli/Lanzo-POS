import React from 'react';
import { normalizePublicPortalTheme } from './_portalTheme.js';
import {
  normalizeSocialText,
  truncateSocialText,
} from './_socialMetadata.js';

const GENERIC_THEME = Object.freeze({
  primaryColor: '#0284c7',
  secondaryColor: '#0369a1',
  cornerStyle: 'rounded',
  fontStyle: 'system',
});
const FALLBACK_NAME = 'Tienda en línea';
const FALLBACK_DESCRIPTION = 'Consulta productos y realiza tu pedido con Lanzo.';
const NOT_FOUND_NAME = 'Tienda no disponible';
const NOT_FOUND_DESCRIPTION = 'Consulta otras tiendas creadas con Lanzo.';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function parseHex(hex) {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

export function colorLuminance(hex) {
  const channels = parseHex(hex).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function readableTextColor(hex) {
  return colorLuminance(hex) > 0.42 ? '#0f172a' : '#ffffff';
}

export function mixOgColor(hex, target, ratio) {
  const sourceChannels = parseHex(hex);
  const targetChannels = parseHex(target);
  const channels = sourceChannels.map((channel, index) => (
    Math.round(channel * (1 - ratio) + targetChannels[index] * ratio)
      .toString(16)
      .padStart(2, '0')
  ));
  return `#${channels.join('')}`;
}

function radius(cornerStyle) {
  if (cornerStyle === 'square') return 0;
  if (cornerStyle === 'soft') return 22;
  return 38;
}

function initialFor(name) {
  const character = Array.from(normalizeSocialText(name))[0];
  return character
    ? Array.from(character.toLocaleUpperCase('es-MX'))[0] || 'L'
    : 'L';
}

function embeddedImage(value) {
  return typeof value === 'string'
    && /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+=*$/iu.test(value)
    ? value
    : null;
}

export function buildStoreOgCardModel({
  result,
  logoImage = null,
  coverImage = null,
} = {}) {
  const isOk = result?.status === 'ok';
  const isNotFound = result?.status === 'not_found';
  const portal = isOk && result.portal && typeof result.portal === 'object'
    ? result.portal
    : {};
  const theme = normalizePublicPortalTheme(isOk ? portal.theme : GENERIC_THEME);
  const name = isOk
    ? truncateSocialText(portal.name, 80) || FALLBACK_NAME
    : (isNotFound ? NOT_FOUND_NAME : FALLBACK_NAME);
  const description = isOk
    ? truncateSocialText(portal.headline || portal.description, 180) || FALLBACK_DESCRIPTION
    : (isNotFound ? NOT_FOUND_DESCRIPTION : FALLBACK_DESCRIPTION);
  const primaryText = readableTextColor(theme.primaryColor);
  const darkPrimary = mixOgColor(theme.primaryColor, '#020617', 0.68);
  const lightAccent = mixOgColor(theme.secondaryColor, '#ffffff', 0.72);

  return deepFreeze({
    label: 'Tienda en línea',
    name,
    description,
    initial: isOk && normalizeSocialText(portal.name) ? initialFor(portal.name) : 'L',
    logoImage: isOk ? embeddedImage(logoImage) : null,
    coverImage: isOk ? embeddedImage(coverImage) : null,
    visual: {
      primaryColor: theme.primaryColor,
      secondaryColor: theme.secondaryColor,
      primaryText,
      darkPrimary,
      lightAccent,
      radius: radius(theme.cornerStyle),
      nameSize: Array.from(name).length > 52 ? 54 : (Array.from(name).length > 30 ? 64 : 76),
    },
    poweredBy: 'Impulsado por Lanzo',
  });
}

const h = React.createElement;

export function StoreOgCard({ model }) {
  const { visual } = model;
  const branding = model.logoImage
    ? h('img', {
        src: model.logoImage,
        alt: '',
        style: { width: 112, height: 112, objectFit: 'contain' },
      })
    : h('div', {
        style: {
          display: 'flex',
          fontSize: 54,
          fontWeight: 800,
          color: visual.darkPrimary,
        },
      }, model.initial);

  return h('div', {
    style: {
      width: '1200px',
      height: '630px',
      display: 'flex',
      position: 'relative',
      overflow: 'hidden',
      color: '#ffffff',
      background: `linear-gradient(135deg, ${visual.darkPrimary}, ${visual.primaryColor})`,
    },
  },
  model.coverImage && h('img', {
    src: model.coverImage,
    alt: '',
    style: {
      position: 'absolute',
      width: '1200px',
      height: '630px',
      objectFit: 'cover',
      opacity: 0.34,
    },
  }),
  h('div', {
    style: {
      position: 'absolute',
      inset: 0,
      display: 'flex',
      background: `linear-gradient(90deg, ${visual.darkPrimary}f2 0%, ${visual.darkPrimary}c9 58%, ${visual.primaryColor}73 100%)`,
    },
  }),
  h('div', {
    style: {
      position: 'absolute',
      width: 380,
      height: 380,
      right: -110,
      top: -100,
      borderRadius: 190,
      backgroundColor: visual.lightAccent,
      opacity: 0.25,
      display: 'flex',
    },
  }),
  h('div', {
    style: {
      position: 'relative',
      width: '100%',
      padding: '58px 68px 48px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
    },
  },
  h('div', { style: { display: 'flex', flexDirection: 'column', maxWidth: 930 } },
    h('div', {
      style: {
        width: 132,
        height: 132,
        borderRadius: visual.radius,
        backgroundColor: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 18px 45px rgba(2, 6, 23, 0.24)',
        marginBottom: 32,
      },
    }, branding),
    h('div', {
      style: {
        display: 'flex',
        alignSelf: 'flex-start',
        padding: '9px 16px',
        borderRadius: 999,
        backgroundColor: visual.lightAccent,
        color: '#0f172a',
        fontSize: 20,
        fontWeight: 700,
        letterSpacing: '0.04em',
        marginBottom: 18,
      },
    }, model.label),
    h('div', {
      style: {
        display: 'flex',
        fontSize: visual.nameSize,
        lineHeight: 1.02,
        fontWeight: 800,
        letterSpacing: '-0.035em',
        marginBottom: 18,
        maxHeight: 156,
        overflow: 'hidden',
      },
    }, model.name),
    h('div', {
      style: {
        display: 'flex',
        fontSize: 30,
        lineHeight: 1.28,
        color: 'rgba(255,255,255,0.88)',
        maxWidth: 870,
        maxHeight: 78,
        overflow: 'hidden',
      },
    }, model.description),
  ),
  h('div', {
    style: {
      display: 'flex',
      fontSize: 20,
      fontWeight: 600,
      color: 'rgba(255,255,255,0.72)',
      letterSpacing: '0.02em',
    },
  }, model.poweredBy)));
}
