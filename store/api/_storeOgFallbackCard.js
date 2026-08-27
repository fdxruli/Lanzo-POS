import React from 'react';

const FALLBACK_NAME = 'Tienda en línea';
const FALLBACK_DESCRIPTION = 'Consulta productos y realiza tu pedido con Lanzo.';
const NOT_FOUND_NAME = 'Tienda no disponible';
const NOT_FOUND_DESCRIPTION = 'Consulta otras tiendas creadas con Lanzo.';
const LABEL = 'Tienda en línea';
const POWERED_BY = 'Impulsado por Lanzo';
const PRIMARY_COLOR = '#0284c7';
const DARK_PRIMARY = '#022e4f';
const LIGHT_ACCENT = '#b8d5e5';

const FALLBACK_VISUAL = Object.freeze({
  primaryColor: PRIMARY_COLOR,
  darkPrimary: DARK_PRIMARY,
  lightAccent: LIGHT_ACCENT,
  radius: 38,
  nameSize: 76,
});

function rgba(hex, alpha) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  return `rgba(${channels.join(',')},${alpha})`;
}

export function buildStoreOgFallbackCardModel({ status } = {}) {
  const normalizedStatus = status === 'not_found' ? 'not_found' : 'unavailable';
  return Object.freeze({
    renderer: 'fallback',
    status: normalizedStatus,
    name: normalizedStatus === 'not_found' ? NOT_FOUND_NAME : FALLBACK_NAME,
    description: normalizedStatus === 'not_found' ? NOT_FOUND_DESCRIPTION : FALLBACK_DESCRIPTION,
    visual: FALLBACK_VISUAL,
  });
}

const h = React.createElement;

export function StoreOgFallbackCard({ model }) {
  const { visual } = model;
  return h('div', {
    style: {
      width: '1200px',
      height: '630px',
      display: 'flex',
      position: 'relative',
      overflow: 'hidden',
      color: '#ffffff',
      backgroundColor: visual.darkPrimary,
      backgroundImage: `linear-gradient(135deg, ${visual.darkPrimary}, ${visual.primaryColor})`,
    },
  },
  h('div', {
    style: {
      position: 'absolute',
      inset: 0,
      display: 'flex',
      backgroundColor: rgba(visual.darkPrimary, 0.95),
      backgroundImage: `linear-gradient(90deg, ${rgba(visual.darkPrimary, 0.95)} 0%, ${rgba(visual.darkPrimary, 0.79)} 58%, ${rgba(visual.primaryColor, 0.45)} 100%)`,
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
    }, h('div', {
      style: {
        display: 'flex',
        fontSize: 54,
        fontWeight: 800,
        color: visual.darkPrimary,
      },
    }, 'L')),
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
    }, LABEL),
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
  }, POWERED_BY)));
}
