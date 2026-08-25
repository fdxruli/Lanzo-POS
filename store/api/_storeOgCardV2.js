import React from 'react';

const EMBEDDED_IMAGE_PATTERN = /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+=*$/iu;
const SUPPORTED_VARIANTS = new Set(['compact', 'classic', 'showcase']);
const h = React.createElement;

function embeddedImage(value) {
  return typeof value === 'string' && EMBEDDED_IMAGE_PATTERN.test(value)
    ? value
    : null;
}

function initialFor(name) {
  const first = Array.from(typeof name === 'string' ? name.trim() : '')[0];
  return first
    ? Array.from(first.toLocaleUpperCase('es-MX'))[0] || 'L'
    : 'L';
}

function radiusFor(cornerStyle) {
  if (cornerStyle === 'square') return 0;
  if (cornerStyle === 'soft') return 24;
  return 40;
}

function requireV2Model(model) {
  if (!model || model.version !== 2 || !model.content || !model.branding || !model.visual) {
    throw new TypeError('StoreOgCardV2 requires a valid V2 model.');
  }
  return model;
}

export function buildStoreOgCardV2RenderState({
  model,
  logoImage = null,
  coverImage = null,
} = {}) {
  const safeModel = requireV2Model(model);
  const variant = SUPPORTED_VARIANTS.has(safeModel.layout?.variant)
    ? safeModel.layout.variant
    : 'classic';

  return Object.freeze({
    model: safeModel,
    variant,
    logoImage: embeddedImage(logoImage),
    coverImage: embeddedImage(coverImage),
    radius: radiusFor(safeModel.visual.cornerStyle),
  });
}

function LogoIdentity({
  state,
  containerSize,
  backgroundColor,
  textColor,
  radius,
}) {
  const { model, logoImage } = state;
  const logoSize = model.visual.logoSize;

  return h('div', {
    style: {
      width: containerSize,
      height: containerSize,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      borderRadius: radius,
      backgroundColor,
      overflow: 'hidden',
    },
  }, logoImage
    ? h('img', {
        src: logoImage,
        alt: '',
        width: logoSize,
        height: logoSize,
        style: {
          width: logoSize,
          height: logoSize,
          objectFit: 'contain',
        },
      })
    : h('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: textColor,
          fontSize: Math.round(logoSize * 0.46),
          fontWeight: 800,
          lineHeight: 1,
        },
      }, initialFor(model.content.name)));
}

function StoreBadge({ model, backgroundColor, textColor }) {
  return h('div', {
    style: {
      display: 'flex',
      alignSelf: 'flex-start',
      padding: '9px 16px',
      borderRadius: 999,
      backgroundColor,
      color: textColor,
      fontSize: 20,
      fontWeight: 700,
      letterSpacing: '0.045em',
      lineHeight: 1.1,
    },
  }, model.content.label);
}

function StoreName({ model, color, maxWidth, maxHeight, marginTop = 0 }) {
  return h('div', {
    style: {
      display: 'flex',
      maxWidth,
      maxHeight,
      marginTop,
      overflow: 'hidden',
      color,
      fontSize: model.visual.titleSize,
      fontWeight: 800,
      lineHeight: 1.02,
      letterSpacing: '-0.035em',
    },
  }, model.content.name);
}

function PoweredBy({ model, color, marginTop = 0 }) {
  return h('div', {
    style: {
      display: 'flex',
      marginTop,
      color,
      fontSize: 19,
      fontWeight: 600,
      letterSpacing: '0.025em',
      lineHeight: 1.15,
    },
  }, model.branding.poweredBy);
}

function CoverFallback({ model, width, height, radius }) {
  const { visual } = model;
  const bubbleSize = Math.round(Math.min(width, height) * 0.54);
  const smallBubble = Math.round(bubbleSize * 0.55);

  return h('div', {
    style: {
      position: 'relative',
      width,
      height,
      display: 'flex',
      overflow: 'hidden',
      borderRadius: radius,
      backgroundColor: visual.surfaceColor,
    },
  },
  h('div', {
    style: {
      position: 'absolute',
      width: bubbleSize,
      height: bubbleSize,
      right: -Math.round(bubbleSize * 0.2),
      top: -Math.round(bubbleSize * 0.17),
      display: 'flex',
      borderRadius: Math.round(bubbleSize / 2),
      backgroundColor: visual.accentSoftColor,
    },
  }),
  h('div', {
    style: {
      position: 'absolute',
      width: smallBubble,
      height: smallBubble,
      left: Math.round(width * 0.12),
      bottom: Math.round(height * 0.12),
      display: 'flex',
      borderRadius: Math.round(smallBubble / 2),
      backgroundColor: visual.accentColor,
    },
  }),
  h('div', {
    style: {
      position: 'absolute',
      width: Math.round(width * 0.58),
      height: 18,
      left: Math.round(width * 0.12),
      top: Math.round(height * 0.48),
      display: 'flex',
      borderRadius: 999,
      backgroundColor: visual.accentSoftColor,
    },
  }));
}

function CoverPanel({ state, width, height, radius }) {
  if (!state.coverImage) {
    return CoverFallback({
      model: state.model,
      width,
      height,
      radius,
    });
  }

  return h('div', {
    style: {
      width,
      height,
      display: 'flex',
      overflow: 'hidden',
      borderRadius: radius,
      backgroundColor: state.model.visual.surfaceColor,
    },
  }, h('img', {
    src: state.coverImage,
    alt: '',
    width,
    height,
    style: {
      width,
      height,
      objectFit: 'cover',
    },
  }));
}

function CompactLayout({ state }) {
  const { model } = state;
  const { visual } = model;
  const logoContainer = visual.logoSize + 24;

  return h('div', {
    'data-og-v2-layout': 'compact',
    style: {
      width: '1200px',
      height: '630px',
      display: 'flex',
      overflow: 'hidden',
      backgroundColor: visual.backgroundColor,
      color: visual.textOnBackground,
    },
  },
  h('div', {
    style: {
      width: 696,
      height: 630,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      padding: '48px 54px 44px 60px',
    },
  },
  LogoIdentity({
    state,
    containerSize: logoContainer,
    backgroundColor: visual.accentSoftColor,
    textColor: visual.textOnBackground,
    radius: state.radius,
  }),
  h('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
    },
  },
  StoreBadge({
    model,
    backgroundColor: visual.accentColor,
    textColor: visual.textOnAccent,
  }),
  StoreName({
    model,
    color: visual.textOnBackground,
    maxWidth: 570,
    maxHeight: 168,
    marginTop: 18,
  }),
  PoweredBy({
    model,
    color: visual.mutedTextColor,
    marginTop: 24,
  }))),
  h('div', {
    style: {
      width: 504,
      height: 630,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      padding: '34px 34px 34px 0',
      backgroundColor: visual.backgroundColor,
    },
  }, CoverPanel({
    state,
    width: 470,
    height: 562,
    radius: state.radius,
  })));
}

function ClassicLayout({ state }) {
  const { model } = state;
  const { visual } = model;
  const logoContainer = visual.logoSize + 20;

  return h('div', {
    'data-og-v2-layout': 'classic',
    style: {
      width: '1200px',
      height: '630px',
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      padding: 42,
      backgroundColor: visual.backgroundColor,
    },
  },
  h('div', {
    style: {
      position: 'absolute',
      width: 230,
      height: 18,
      top: 0,
      left: 62,
      display: 'flex',
      borderRadius: 999,
      backgroundColor: visual.accentColor,
    },
  }),
  h('div', {
    style: {
      width: 1116,
      height: 546,
      display: 'flex',
      overflow: 'hidden',
      borderRadius: state.radius,
      backgroundColor: visual.surfaceColor,
    },
  },
  h('div', {
    style: {
      width: 600,
      height: 546,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      padding: '44px 48px 40px 50px',
      color: visual.textOnSurface,
    },
  },
  h('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
    },
  },
  LogoIdentity({
    state,
    containerSize: logoContainer,
    backgroundColor: visual.backgroundColor,
    textColor: visual.textOnBackground,
    radius: state.radius,
  }),
  h('div', {
    style: {
      display: 'flex',
      marginTop: 24,
    },
  }, StoreBadge({
    model,
    backgroundColor: visual.accentColor,
    textColor: visual.textOnAccent,
  })),
  StoreName({
    model,
    color: visual.textOnSurface,
    maxWidth: 500,
    maxHeight: 164,
    marginTop: 18,
  })),
  PoweredBy({
    model,
    color: visual.mutedTextColor,
  })),
  CoverPanel({
    state,
    width: 516,
    height: 546,
    radius: 0,
  })));
}

function ShowcaseBackdrop({ state }) {
  const { model } = state;
  const { visual } = model;

  if (state.coverImage) {
    return h('img', {
      src: state.coverImage,
      alt: '',
      width: 1200,
      height: 630,
      style: {
        position: 'absolute',
        width: 1200,
        height: 630,
        objectFit: 'cover',
      },
    });
  }

  return h('div', {
    style: {
      position: 'absolute',
      width: 1200,
      height: 630,
      display: 'flex',
      overflow: 'hidden',
      backgroundColor: visual.backgroundColor,
    },
  },
  h('div', {
    style: {
      position: 'absolute',
      width: 720,
      height: 720,
      right: -160,
      top: -180,
      display: 'flex',
      borderRadius: 360,
      backgroundColor: visual.accentSoftColor,
    },
  }),
  h('div', {
    style: {
      position: 'absolute',
      width: 430,
      height: 430,
      right: 90,
      bottom: -220,
      display: 'flex',
      borderRadius: 215,
      backgroundColor: visual.accentColor,
    },
  }));
}

function ShowcaseLayout({ state }) {
  const { model } = state;
  const { visual } = model;
  const logoContainer = visual.logoSize + 20;

  return h('div', {
    'data-og-v2-layout': 'showcase',
    style: {
      width: '1200px',
      height: '630px',
      position: 'relative',
      display: 'flex',
      overflow: 'hidden',
      backgroundColor: visual.backgroundColor,
    },
  },
  ShowcaseBackdrop({ state }),
  h('div', {
    style: {
      position: 'absolute',
      left: 46,
      top: 42,
      display: 'flex',
    },
  }, LogoIdentity({
    state,
    containerSize: logoContainer,
    backgroundColor: visual.surfaceColor,
    textColor: visual.textOnSurface,
    radius: state.radius,
  })),
  h('div', {
    style: {
      position: 'absolute',
      left: 46,
      bottom: 42,
      width: 672,
      height: 246,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      padding: '30px 34px 26px',
      overflow: 'hidden',
      borderRadius: state.radius,
      backgroundColor: visual.surfaceColor,
      color: visual.textOnSurface,
    },
  },
  h('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
    },
  },
  StoreBadge({
    model,
    backgroundColor: visual.accentColor,
    textColor: visual.textOnAccent,
  }),
  StoreName({
    model,
    color: visual.textOnSurface,
    maxWidth: 600,
    maxHeight: 142,
    marginTop: 14,
  })),
  PoweredBy({
    model,
    color: visual.mutedTextColor,
    marginTop: 18,
  })),
  h('div', {
    style: {
      position: 'absolute',
      right: 38,
      bottom: 38,
      width: 132,
      height: 12,
      display: 'flex',
      borderRadius: 999,
      backgroundColor: visual.accentColor,
    },
  }));
}

export function StoreOgCardV2({
  model,
  logoImage = null,
  coverImage = null,
} = {}) {
  const state = buildStoreOgCardV2RenderState({ model, logoImage, coverImage });

  if (state.variant === 'compact') return CompactLayout({ state });
  if (state.variant === 'showcase') return ShowcaseLayout({ state });
  return ClassicLayout({ state });
}
