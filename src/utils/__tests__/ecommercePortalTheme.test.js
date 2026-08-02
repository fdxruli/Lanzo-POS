import { describe, expect, it } from 'vitest';
import {
  buildEcommercePortalThemeStyle,
  buildEcommerceSiteDesignStyle,
  contrastRatio,
  hexToRgb,
  mixEcommercePortalColors,
  normalizeEcommercePortalTemplate,
  normalizeEcommercePortalTheme,
  relativeLuminance,
  selectAccessibleTextColor
} from '../ecommercePortalTheme';

describe('ecommercePortalTheme', () => {
  it('falls back safely for corrupt theme data and unknown templates', () => {
    expect(normalizeEcommercePortalTemplate('arbitrary-css')).toBe('classic');
    expect(normalizeEcommercePortalTheme(['#fff'])).toEqual({
      primaryColor: '#0284c7', secondaryColor: '#0369a1', cornerStyle: 'rounded', fontStyle: 'system'
    });
  });

  it('keeps only known valid values and emits controlled legacy-compatible variables', () => {
    const theme = normalizeEcommercePortalTheme({
      primaryColor: '#ffffff', secondaryColor: '#123456', cornerStyle: 'square', fontStyle: 'editorial', css: 'url(javascript:bad)'
    });
    const style = buildEcommercePortalThemeStyle(theme);
    expect(theme).toEqual({ primaryColor: '#ffffff', secondaryColor: '#123456', cornerStyle: 'square', fontStyle: 'editorial' });
    expect(style).toMatchObject({
      '--store-primary': '#ffffff', '--store-secondary': '#123456', '--store-on-primary': '#000000',
      '--store-radius-card': '0', '--store-radius-button': '0',
      '--store-font-family': 'Georgia, Cambria, "Times New Roman", serif'
    });
  });

  it('does not accept arbitrary color syntax', () => {
    expect(normalizeEcommercePortalTheme({ primaryColor: 'var(--evil)', secondaryColor: 'rgb(1,2,3)' })).toMatchObject({
      primaryColor: '#0284c7', secondaryColor: '#0369a1'
    });
  });

  it('uses pure validated colour calculations and selects AA text for light and dark brands', () => {
    expect(hexToRgb('#0284c7')).toEqual({ r: 2, g: 132, b: 199 });
    expect(hexToRgb('rgb(1, 2, 3)')).toBeNull();
    expect(relativeLuminance('#ffffff')).toBe(1);
    expect(contrastRatio('#ffffff', '#000000')).toBe(21);
    expect(mixEcommercePortalColors('invalid', '#ffffff', 0.5)).toMatch(/^#[0-9a-f]{6}$/);

    ['#ffffff', '#111827', '#0284c7', '#facc15'].forEach((background) => {
      const text = selectAccessibleTextColor(background);
      expect(contrastRatio(text, background)).toBeGreaterThanOrEqual(4.5);
    });
  });

  it('derives the full deterministic storefront token set without invalid CSS', () => {
    const requiredTokens = [
      '--store-primary', '--store-primary-hover', '--store-primary-active', '--store-primary-soft',
      '--store-secondary', '--store-secondary-hover', '--store-secondary-soft', '--store-on-primary', '--store-on-secondary',
      '--store-page-bg', '--store-surface', '--store-surface-elevated', '--store-surface-muted', '--store-surface-brand-soft',
      '--store-text', '--store-text-strong', '--store-text-muted', '--store-text-brand', '--store-border', '--store-border-strong', '--store-focus-ring',
      '--store-font-body', '--store-font-heading', '--store-font-family', '--store-radius-card', '--store-radius-button', '--store-radius-media', '--store-radius-panel',
      '--store-shadow-card', '--store-shadow-elevated', '--store-shadow-floating', '--store-content-max', '--store-page-padding', '--store-section-gap', '--store-grid-gap', '--store-card-padding', '--store-header-cover-height'
    ];
    const options = { theme: { primaryColor: '#facc15', secondaryColor: '#111827', cornerStyle: 'soft', fontStyle: 'editorial' }, templateCode: 'showcase', density: 'compact', contentWidth: 'standard' };
    const style = buildEcommerceSiteDesignStyle(options);
    expect(buildEcommerceSiteDesignStyle(options)).toEqual(style);
    expect(requiredTokens.every((token) => Object.hasOwn(style, token))).toBe(true);
    expect(Object.values(style).join(' ')).not.toMatch(/undefined|NaN/);
    expect(contrastRatio(style['--store-on-primary'], style['--store-primary'])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(style['--store-on-secondary'], style['--store-secondary'])).toBeGreaterThanOrEqual(4.5);
    expect(style['--store-font-heading']).toContain('Georgia');
    expect(style['--store-radius-card']).toBe('0.5rem');
  });

  it('makes visual profile and density tokens distinct for every supported template', () => {
    const classic = buildEcommerceSiteDesignStyle({ templateCode: 'classic', density: 'comfortable' });
    const showcase = buildEcommerceSiteDesignStyle({ templateCode: 'showcase', density: 'comfortable' });
    const compact = buildEcommerceSiteDesignStyle({ templateCode: 'compact', density: 'compact' });
    expect(showcase['--store-shadow-card']).not.toBe(classic['--store-shadow-card']);
    expect(showcase['--store-section-gap']).not.toBe(classic['--store-section-gap']);
    expect(compact['--store-header-cover-height']).not.toBe(classic['--store-header-cover-height']);
    expect(compact['--store-card-padding']).not.toBe(classic['--store-card-padding']);
  });
});
