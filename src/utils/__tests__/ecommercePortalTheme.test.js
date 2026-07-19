import { describe, expect, it } from 'vitest';
import {
  buildEcommercePortalThemeStyle,
  normalizeEcommercePortalTemplate,
  normalizeEcommercePortalTheme
} from '../ecommercePortalTheme';

describe('ecommercePortalTheme', () => {
  it('falls back safely for corrupt theme data and unknown templates', () => {
    expect(normalizeEcommercePortalTemplate('arbitrary-css')).toBe('classic');
    expect(normalizeEcommercePortalTheme(['#fff'])).toEqual({
      primaryColor: '#0284c7', secondaryColor: '#0369a1', cornerStyle: 'rounded', fontStyle: 'system'
    });
  });

  it('keeps only known valid values and emits only controlled CSS variables', () => {
    const theme = normalizeEcommercePortalTheme({
      primaryColor: '#ffffff', secondaryColor: '#123456', cornerStyle: 'square', fontStyle: 'editorial', css: 'url(javascript:bad)'
    });
    const style = buildEcommercePortalThemeStyle(theme);
    expect(theme).toEqual({ primaryColor: '#ffffff', secondaryColor: '#123456', cornerStyle: 'square', fontStyle: 'editorial' });
    expect(Object.keys(style)).toEqual([
      '--store-primary', '--store-primary-hover', '--store-secondary', '--store-on-primary', '--store-radius-card', '--store-radius-button', '--store-font-family'
    ]);
    expect(style['--store-on-primary']).toBe('#0f172a');
  });

  it('does not accept arbitrary color syntax', () => {
    expect(normalizeEcommercePortalTheme({ primaryColor: 'var(--evil)', secondaryColor: 'rgb(1,2,3)' })).toMatchObject({
      primaryColor: '#0284c7', secondaryColor: '#0369a1'
    });
  });
});
