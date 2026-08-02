// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultEcommerceSiteDocument } from '../../../../utils/ecommerceSiteDocument';
import EcommerceSiteVisualSurface from '../EcommerceSiteVisualSurface';

describe('EcommerceSiteVisualSurface', () => {
  afterEach(cleanup);

  it('applies v2 tokens and metadata without leaking variables to the document', () => {
    const siteDocument = createDefaultEcommerceSiteDocument({
      templateCode: 'showcase',
      theme: { primaryColor: '#facc15', secondaryColor: '#111827', cornerStyle: 'soft', fontStyle: 'rounded' }
    });
    const { container } = render(
      <EcommerceSiteVisualSurface siteDocument={siteDocument} siteDocumentMode="custom" mode="public">
        <p>Contenido de prueba</p>
      </EcommerceSiteVisualSurface>
    );
    const surface = container.querySelector('.ecommerce-site-visual-surface');
    expect(surface).toHaveAttribute('data-site-template', 'showcase');
    expect(surface).toHaveAttribute('data-site-density', 'comfortable');
    expect(surface).toHaveAttribute('data-site-content-width', 'standard');
    expect(surface).toHaveAttribute('data-site-mode', 'public');
    expect(surface.style.getPropertyValue('--store-page-bg')).toBeTruthy();
    expect(surface.style.getPropertyValue('--ui-bg-surface')).toBe('');
    expect(screen.getByText('Contenido de prueba')).toBeTruthy();
    expect(document.documentElement.style.getPropertyValue('--store-primary')).toBe('');
    expect(document.body.style.getPropertyValue('--store-primary')).toBe('');
  });

  it('normalizes legacy documents and uses safe defaults without a portal', () => {
    const { container } = render(
      <EcommerceSiteVisualSurface siteDocument={{ schemaVersion: 1 }} mode="editor">
        <span>Legacy</span>
      </EcommerceSiteVisualSurface>
    );
    const surface = container.querySelector('.ecommerce-site-visual-surface');
    expect(surface).toHaveAttribute('data-site-template', 'classic');
    expect(surface).toHaveAttribute('data-site-mode', 'editor');
    expect(surface.style.getPropertyValue('--store-surface')).toBe('#ffffff');
  });
});
