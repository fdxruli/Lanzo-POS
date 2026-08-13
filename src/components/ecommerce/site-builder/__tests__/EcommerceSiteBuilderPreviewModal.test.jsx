// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultEcommerceSiteDocument } from '../../../../utils/ecommerceSiteDocument';
import EcommerceSiteBuilderPreviewModal from '../EcommerceSiteBuilderPreviewModal';

const portal = {
  name: 'Tienda preview', slug: 'preview', templateCode: 'classic', headline: 'Vista de prueba',
  description: 'Portal de prueba', pickupEnabled: true, deliveryEnabled: false
};
const renderModal = (props = {}) => render(
  <MemoryRouter>
    <EcommerceSiteBuilderPreviewModal document={createDefaultEcommerceSiteDocument()} portal={portal} onClose={vi.fn()} {...props} />
  </MemoryRouter>
);

describe('EcommerceSiteBuilderPreviewModal', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('opens an accessible modal, starts on desktop, and switches its virtual viewport', () => {
    const onClose = vi.fn();
    renderModal({ onClose });

    expect(screen.getByRole('dialog', { name: 'Vista previa del portal' })).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'Escritorio' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Móvil' })).toHaveAttribute('aria-pressed', 'false');
    expect(document.body.style.overflow).toBe('hidden');
    expect(screen.getByRole('button', { name: 'Cerrar vista previa' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Móvil' }));
    expect(screen.getByRole('button', { name: 'Móvil' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('.ecom-builder-preview-inert')).toHaveAttribute('data-preview-viewport', 'mobile');

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar vista previa' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('uses the mobile viewport by default on narrow devices', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addListener: vi.fn(), removeListener: vi.fn() })));
    renderModal();
    expect(screen.getByRole('button', { name: 'Móvil' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders current unsaved changes through the shared renderer and stays inert', () => {
    const siteDocument = createDefaultEcommerceSiteDocument();
    const { rerender } = renderModal({ document: siteDocument });
    expect(document.querySelector('.ecommerce-site-renderer')).toHaveAttribute('data-site-density', 'comfortable');
    expect(document.querySelector('.ecom-builder-preview-inert')).toHaveAttribute('inert');

    const updated = createDefaultEcommerceSiteDocument();
    updated.global.density = 'compact';
    rerender(
      <MemoryRouter>
        <EcommerceSiteBuilderPreviewModal document={updated} portal={portal} onClose={vi.fn()} />
      </MemoryRouter>
    );
    expect(document.querySelector('.ecommerce-site-renderer')).toHaveAttribute('data-site-density', 'compact');
  });

  it('closes with Escape and restores focus to the preview trigger', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Vista previa';
    document.body.append(trigger);
    trigger.focus();
    const onClose = vi.fn();
    const { unmount } = renderModal({ onClose });

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
